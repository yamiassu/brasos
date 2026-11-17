use smithay::{
    desktop::{PopupKind, PopupManager, Space, Window, find_popup_root_surface, get_popup_toplevel_coords},
    input::{
        Seat,
        pointer::{Focus, GrabStartData as PointerGrabStartData},
    },
    reexports::{
        wayland_protocols::xdg::shell::server::xdg_toplevel,
        wayland_server::{
            Resource,
            protocol::{wl_seat, wl_surface::WlSurface},
        },
    },
    utils::{Rectangle, Serial},
    wayland::{
        compositor::with_states,
        shell::xdg::{
            PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
            XdgToplevelSurfaceData,
        },
    },
};

use crate::{
    Smallvil,
    grabs::{MoveSurfaceGrab, ResizeSurfaceGrab},
};

// The shell draws every native window's frame, so a client is asked not to draw its own (server-side decoration).
impl smithay::wayland::shell::xdg::decoration::XdgDecorationHandler for Smallvil {
    fn new_decoration(&mut self, toplevel: ToplevelSurface) {
        use smithay::reexports::wayland_protocols::xdg::decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode;
        smithay::wayland::compositor::with_states(toplevel.wl_surface(), |s| {
            s.data_map.insert_if_missing_threadsafe(|| super::SsdMarker);
        });
        toplevel.with_pending_state(|s| s.decoration_mode = Some(Mode::ServerSide));
        toplevel.send_configure();
    }
    fn request_mode(&mut self, toplevel: ToplevelSurface, _mode: smithay::reexports::wayland_protocols::xdg::decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode) {
        self.new_decoration(toplevel);
    }
    fn unset_mode(&mut self, toplevel: ToplevelSurface) {
        self.new_decoration(toplevel);
    }
    fn decoration_destroyed(&mut self, _toplevel: ToplevelSurface) {}
}

impl XdgShellHandler for Smallvil {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        let window = Window::new_wayland_window(surface);
        let new = window.clone();
        self.space.map_element(window, (60, 60), true); // above the shell (retile puts the shell back below if this is it)
        self.retile();
        if std::mem::take(&mut self.focus_next) {
            if let (Some(kb), Some(t)) = (self.seat.get_keyboard(), new.toplevel()) {
                kb.set_focus(self, Some(t.wl_surface().clone()), smithay::utils::SERIAL_COUNTER.next_serial());
            }
        }
    }

    // A client that asks for fullscreen (Chromium's kiosk mode) gets the fullscreen state, so it hides its own chrome, but keeps
    // its tile: the shell and a native app share the screen, so "fullscreen" means "no window decorations", not "cover the rest".
    fn fullscreen_request(&mut self, surface: ToplevelSurface, _output: Option<smithay::reexports::wayland_server::protocol::wl_output::WlOutput>) {
        surface.with_pending_state(|s| {
            s.states.set(xdg_toplevel::State::Fullscreen);
        });
        self.retile();
    }

    fn unfullscreen_request(&mut self, surface: ToplevelSurface) {
        surface.with_pending_state(|s| {
            s.states.unset(xdg_toplevel::State::Fullscreen);
        });
        surface.send_pending_configure();
    }

    // The shell is Chromium: when it identifies itself it takes the keyboard, whichever window mapped first (a native app is
    // often faster). A click or the shell's `focus` command moves focus from there.
    fn app_id_changed(&mut self, surface: ToplevelSurface) {
        let shell = surface.parent().is_none() && smithay::wayland::compositor::with_states(surface.wl_surface(), |s| {
            s.data_map.get::<XdgToplevelSurfaceData>().and_then(|d| d.lock().unwrap().app_id.clone()).is_some_and(|id| id.starts_with("chromium"))
        });
        if shell {
            self.retile();
            if let Some(kb) = self.seat.get_keyboard() {
                kb.set_focus(self, Some(surface.wl_surface().clone()), smithay::utils::SERIAL_COUNTER.next_serial());
            }
        }
    }

    // A dialog (a window with a parent: the browser's file picker, a save dialog) opens above everything and takes the keyboard, so it can be
    // seen and typed into at once; it is an app window, not the shell (see `is_shell`).
    fn parent_changed(&mut self, surface: ToplevelSurface) {
        if surface.parent().is_none() {
            return;
        }
        let Some(me) = self.space.elements().find(|w| w.toplevel() == Some(&surface)).cloned() else { return };
        self.space.raise_element(&me, true);
        self.retile();
        if let Some(kb) = self.seat.get_keyboard() {
            kb.set_focus(self, Some(surface.wl_surface().clone()), smithay::utils::SERIAL_COUNTER.next_serial());
        }
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        let gone = self.space.elements().find(|w| w.toplevel() == Some(&surface)).cloned();
        if let Some(w) = gone {
            self.space.unmap_elem(&w);
        }
        self.retile();
    }

    fn new_popup(&mut self, surface: PopupSurface, _positioner: PositionerState) {
        self.unconstrain_popup(&surface);
        let _ = self.popups.track_popup(PopupKind::Xdg(surface));
    }

    fn reposition_request(&mut self, surface: PopupSurface, positioner: PositionerState, token: u32) {
        surface.with_pending_state(|state| {
            let geometry = positioner.get_geometry();
            state.geometry = geometry;
            state.positioner = positioner;
        });
        self.unconstrain_popup(&surface);
        surface.send_repositioned(token);
    }

    fn move_request(&mut self, surface: ToplevelSurface, seat: wl_seat::WlSeat, serial: Serial) {
        let seat = Seat::from_resource(&seat).unwrap();

        let wl_surface = surface.wl_surface();

        if let Some(start_data) = check_grab(&seat, wl_surface, serial) {
            let pointer = seat.get_pointer().unwrap();

            let window = self
                .space
                .elements()
                .find(|w| crate::state::is_surface(w, wl_surface))
                .unwrap()
                .clone();
            let initial_window_location = self.space.element_location(&window).unwrap();

            let grab = MoveSurfaceGrab {
                start_data,
                window,
                initial_window_location,
            };

            pointer.set_grab(self, grab, serial, Focus::Clear);
        }
    }

    fn resize_request(
        &mut self,
        surface: ToplevelSurface,
        seat: wl_seat::WlSeat,
        serial: Serial,
        edges: xdg_toplevel::ResizeEdge,
    ) {
        let seat = Seat::from_resource(&seat).unwrap();

        let wl_surface = surface.wl_surface();

        if let Some(start_data) = check_grab(&seat, wl_surface, serial) {
            let pointer = seat.get_pointer().unwrap();

            let window = self
                .space
                .elements()
                .find(|w| crate::state::is_surface(w, wl_surface))
                .unwrap()
                .clone();
            let initial_window_location = self.space.element_location(&window).unwrap();
            let initial_window_size = window.geometry().size;

            surface.with_pending_state(|state| {
                state.states.set(xdg_toplevel::State::Resizing);
            });

            surface.send_pending_configure();

            let grab = ResizeSurfaceGrab::start(
                start_data,
                window,
                edges.into(),
                Rectangle::new(initial_window_location, initial_window_size),
            );

            pointer.set_grab(self, grab, serial, Focus::Clear);
        }
    }

    fn grab(&mut self, _surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        // TODO popup grabs
    }
}

fn check_grab(
    seat: &Seat<Smallvil>,
    surface: &WlSurface,
    serial: Serial,
) -> Option<PointerGrabStartData<Smallvil>> {
    let pointer = seat.get_pointer()?;

    // Check that this surface has a click grab.
    if !pointer.has_grab(serial) {
        return None;
    }

    let start_data = pointer.grab_start_data()?;

    let (focus, _) = start_data.focus.as_ref()?;
    // If the focus was for a different surface, ignore the request.
    if !focus.id().same_client_as(&surface.id()) {
        return None;
    }

    Some(start_data)
}

/// Should be called on `WlSurface::commit`
pub fn handle_commit(popups: &mut PopupManager, space: &Space<Window>, surface: &WlSurface) {
    // Handle toplevel commits.
    if let Some(window) = space
        .elements()
        .find(|w| w.toplevel().is_some_and(|t| t.wl_surface() == surface))
        .cloned()
    {
        let initial_configure_sent = with_states(surface, |states| {
            states
                .data_map
                .get::<XdgToplevelSurfaceData>()
                .unwrap()
                .lock()
                .unwrap()
                .initial_configure_sent
        });

        if !initial_configure_sent {
            window.toplevel().unwrap().send_configure();
        }
    }

    // Handle popup commits.
    popups.commit(surface);
    if let Some(popup) = popups.find_popup(surface) {
        match popup {
            PopupKind::Xdg(ref xdg) => {
                if !xdg.is_initial_configure_sent() {
                    // NOTE: This should never fail as the initial configure is always
                    // allowed.
                    xdg.send_configure().expect("initial configure failed");
                }
            }
            PopupKind::InputMethod(ref _input_method) => {}
        }
    }
}

impl Smallvil {
    /// The shell (Chromium) fills the output; native windows are left where the shell placed them (see ctl `place`).
    pub fn retile(&mut self) {
        let Some(geo) = self.space.outputs().next().and_then(|o| self.space.output_geometry(o)) else { return };
        let shells: Vec<Window> = self.space.elements().filter(|w| crate::state::is_shell(w)).cloned().collect();
        for win in shells {
            if let Some(t) = win.toplevel() {
                t.with_pending_state(|s| s.size = Some(geo.size));
                t.send_pending_configure();
            }
            self.space.map_element(win, geo.loc, false);
        }
        // the shell is the bottom layer: lift every other window above it, keeping their order
        let others: Vec<Window> = self.space.elements().filter(|w| !crate::state::is_shell(w)).cloned().collect();
        for w in others {
            self.space.raise_element(&w, false);
        }
        // keyboard focus defaults to the first window (the shell); a click or the shell's `focus` command moves it
        let first = self.space.elements().next().and_then(crate::state::wl_of);
        if let (Some(kb), Some(first)) = (self.seat.get_keyboard(), first) {
            if kb.current_focus().is_none() {
                kb.set_focus(self, Some(first), smithay::utils::SERIAL_COUNTER.next_serial());
            }
        }
    }

    fn unconstrain_popup(&self, popup: &PopupSurface) {
        let Ok(root) = find_popup_root_surface(&PopupKind::Xdg(popup.clone())) else {
            return;
        };
        let Some(window) = self
            .space
            .elements()
            .find(|w| crate::state::is_surface(w, &root))
        else {
            return;
        };

        let output = self.space.outputs().next().unwrap();
        let output_geo = self.space.output_geometry(output).unwrap();
        let window_geo = self.space.element_geometry(window).unwrap();

        // The target geometry for the positioner should be relative to its parent's geometry, so
        // we will compute that here.
        let mut target = output_geo;
        target.loc -= get_popup_toplevel_coords(&PopupKind::Xdg(popup.clone()));
        target.loc -= window_geo.loc;

        popup.with_pending_state(|state| {
            state.geometry = state.positioner.get_unconstrained_geometry(target);
        });
    }
}
