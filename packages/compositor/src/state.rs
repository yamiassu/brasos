use std::{ffi::OsString, sync::Arc};

use smithay::{
    desktop::{PopupManager, Space, Window, WindowSurfaceType},
    input::{Seat, SeatState},
    reexports::{
        calloop::{EventLoop, Interest, LoopHandle, LoopSignal, Mode, PostAction, generic::Generic},
        wayland_server::{
            Display, DisplayHandle,
            backend::{ClientData, ClientId, DisconnectReason},
            protocol::wl_surface::WlSurface,
        },
    },
    utils::{Logical, Point},
    wayland::{
        compositor::{CompositorClientState, CompositorState},
        output::OutputManagerState,
        selection::data_device::DataDeviceState,
        shell::xdg::XdgShellState,
        seat::WaylandFocus,
        shell::xdg::decoration::XdgDecorationState,
        shm::ShmState,
        socket::ListeningSocketSource,
        xwayland_shell::XWaylandShellState,
    },
    xwayland::{X11Wm, XWayland, XWaylandEvent},
};

/// the wl_surface of a window, Wayland or X11 (an X11 window has one once Xwayland has associated it)
pub fn wl_of(w: &Window) -> Option<WlSurface> {
    w.wl_surface().map(|s| s.into_owned())
}

/// The shell is the Chromium window: it fills the output and stays at the bottom. Every other window is a native app window,
/// floating above it; the shell draws their frames and says where their content goes (`place` on the control socket).
pub fn is_shell(w: &Window) -> bool {
    w.toplevel().is_some_and(|t| {
        smithay::wayland::compositor::with_states(t.wl_surface(), |s| {
            s.data_map
                .get::<smithay::wayland::shell::xdg::XdgToplevelSurfaceData>()
                .and_then(|d| d.lock().unwrap().app_id.clone())
                .is_some_and(|id| id.starts_with("chromium"))
        })
    })
}

pub fn is_surface(w: &Window, s: &WlSurface) -> bool {
    w.wl_surface().is_some_and(|x| &*x == s)
}

pub struct Smallvil {
    pub start_time: std::time::Instant,
    pub socket_name: OsString,
    pub display_handle: DisplayHandle,

    pub space: Space<Window>,
    pub loop_signal: LoopSignal,

    // Smithay State
    pub compositor_state: CompositorState,
    pub xdg_shell_state: XdgShellState,
    pub shm_state: ShmState,
    pub output_manager_state: OutputManagerState,
    pub seat_state: SeatState<Smallvil>,
    pub data_device_state: DataDeviceState,
    pub popups: PopupManager,

    pub xwayland_shell_state: XWaylandShellState,
    pub xdg_decoration_state: XdgDecorationState,
    /// the X11 window manager once Xwayland is up, and the display number apps get as DISPLAY=:N
    pub xwm: Option<X11Wm>,
    pub xdisplay: Option<u32>,
    pub handle: LoopHandle<'static, Smallvil>,

    pub seat: Seat<Self>,
    pub ctl: Option<crate::ctl::Ctl>,
    /// an app the shell just launched: its first window takes the keyboard
    pub focus_next: bool,
    /// Ctrl+Alt+F1..F12: switch to a text console (set by the DRM backend, which owns the seat session; None when nested)
    pub switch_vt: Option<Box<dyn FnMut(i32)>>,
}

impl Smallvil {
    pub fn new(event_loop: &mut EventLoop<'static, Self>, display: Display<Self>) -> Self {
        let start_time = std::time::Instant::now();

        let dh = display.handle();

        // Here we initialize implementations of some wayland protocols
        // Some of them require us to implement traits on the Smallvil state,
        // you can find those implementations in the `crate::handlers` module

        // Initialize protocols needed for displaying windows
        let compositor_state = CompositorState::new::<Self>(&dh);
        let xdg_shell_state = XdgShellState::new::<Self>(&dh);
        let shm_state = ShmState::new::<Self>(&dh, vec![]);
        let popups = PopupManager::default();
        let xwayland_shell_state = XWaylandShellState::new::<Self>(&dh);
        let xdg_decoration_state = XdgDecorationState::new::<Self>(&dh);

        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&dh);

        // Data device is responsible for clipboard and drag-and-drop
        let data_device_state = DataDeviceState::new::<Self>(&dh);

        // A seat is a group of keyboards, pointer and touch devices.
        // A seat typically has a pointer and maintains a keyboard focus and a pointer focus.
        let mut seat_state = SeatState::new();
        let mut seat: Seat<Self> = seat_state.new_wl_seat(&dh, "winit");

        // Notify clients that we have a keyboard, for the sake of the example we assume that keyboard is always present.
        // You may want to track keyboard hot-plug in real compositor.
        seat.add_keyboard(Default::default(), 200, 25).unwrap();

        // Notify clients that we have a pointer (mouse)
        // Here we assume that there is always pointer plugged in
        seat.add_pointer();

        // A space represents a two-dimensional plane. Windows and Outputs can be mapped onto it.
        //
        // Windows get a position and stacking order through mapping.
        // Outputs become views of a part of the Space and can be rendered via Space::render_output.
        let space = Space::default();

        // Setup a wayland socket that will be used to accept clients
        let socket_name = Self::init_wayland_listener(display, event_loop);

        // Get the loop signal, used to stop the event loop
        let loop_signal = event_loop.get_signal();

        Self {
            start_time,
            display_handle: dh,

            space,
            loop_signal,
            socket_name,

            compositor_state,
            xdg_shell_state,
            shm_state,
            output_manager_state,
            seat_state,
            data_device_state,
            popups,
            xwayland_shell_state,
            xdg_decoration_state,
            xwm: None,
            xdisplay: None,
            handle: event_loop.handle(),
            seat,
            ctl: None,
            focus_next: false,
            switch_vt: None,
        }
    }

    fn init_wayland_listener(display: Display<Smallvil>, event_loop: &mut EventLoop<Self>) -> OsString {
        // Creates a new listening socket, automatically choosing the next available `wayland` socket name.
        let listening_socket = ListeningSocketSource::new_auto().unwrap();

        // Get the name of the listening socket.
        // Clients will connect to this socket.
        let socket_name = listening_socket.socket_name().to_os_string();

        let loop_handle = event_loop.handle();

        loop_handle
            .insert_source(listening_socket, move |client_stream, _, state| {
                // Inside the callback, you should insert the client into the display.
                //
                // You may also associate some data with the client when inserting the client.
                state
                    .display_handle
                    .insert_client(client_stream, Arc::new(ClientState::default()))
                    .unwrap();
            })
            .expect("Failed to init the wayland event source.");

        // You also need to add the display itself to the event loop, so that client events will be processed by wayland-server.
        loop_handle
            .insert_source(
                Generic::new(display, Interest::READ, Mode::Level),
                |_, display, state| {
                    // Safety: we don't drop the display
                    unsafe {
                        display.get_mut().dispatch_clients(state).unwrap();
                    }
                    Ok(PostAction::Continue)
                },
            )
            .unwrap();

        socket_name
    }

    /// raise a window and give it the keyboard (an X11 window is also told it is the active one)
    pub fn focus_window(&mut self, window: &Window) {
        if !is_shell(window) {
            self.space.raise_element(window, true); // the shell stays below the native windows
        }
        let Some(s) = wl_of(window) else { return };
        if let Some(kb) = self.seat.get_keyboard() {
            kb.set_focus(self, Some(s), smithay::utils::SERIAL_COUNTER.next_serial());
        }
        for w in self.space.elements() {
            if let Some(x) = w.x11_surface() {
                let _ = x.set_activated(w == window);
            } else if let Some(t) = w.toplevel() {
                t.send_pending_configure();
            }
        }
        if let (Some(x), Some(wm)) = (window.x11_surface(), self.xwm.as_mut()) {
            let _ = wm.raise_window(x);
        }
    }

    /// the next window in the space (focusing raises it, so repeated presses walk through all of them) takes the keyboard
    pub fn cycle_focus(&mut self) {
        let wins: Vec<Window> = self
            .space
            .elements()
            .filter(|w| wl_of(w).is_some() && !w.x11_surface().is_some_and(|x| x.is_override_redirect()))
            .cloned()
            .collect();
        if wins.is_empty() {
            return;
        }
        let cur = self.seat.get_keyboard().and_then(|k| k.current_focus());
        let i = wins.iter().position(|w| cur.as_ref().is_some_and(|c| is_surface(w, c))).map_or(0, |i| i + 1);
        self.focus_window(&wins[i % wins.len()].clone());
    }

    /// Start Xwayland (X11 apps such as Steam). Its output goes to `log`; X11 apps are then given DISPLAY=:<n>.
    pub fn start_xwayland(&mut self, log: Option<std::fs::File>) {
        use std::process::Stdio;
        let out = |l: &Option<std::fs::File>| l.as_ref().and_then(|f| f.try_clone().ok()).map(Stdio::from).unwrap_or_else(Stdio::null);
        let spawned = XWayland::spawn(
            &self.display_handle,
            None,
            std::iter::empty::<(String, String)>(),
            std::iter::empty::<String>(),
            true,
            out(&log),
            out(&log),
            |_| (),
        );
        let (xwayland, client) = match spawned {
            Ok(x) => x,
            Err(e) => return eprintln!("brasos-comp: xwayland: {e}"),
        };
        let dh = self.display_handle.clone();
        let r = self.handle.insert_source(xwayland, move |event, _, state| match event {
            XWaylandEvent::Ready { x11_socket, display_number } => {
                match X11Wm::start_wm(state.handle.clone(), &dh, x11_socket, client.clone()) {
                    Ok(wm) => {
                        state.xwm = Some(wm);
                        state.xdisplay = Some(display_number);
                        eprintln!("brasos-comp: xwayland ready on :{display_number}");
                    }
                    Err(e) => eprintln!("brasos-comp: x11 wm: {e}"),
                }
            }
            XWaylandEvent::Error => eprintln!("brasos-comp: xwayland failed to start"),
        });
        if let Err(e) = r {
            eprintln!("brasos-comp: xwayland source: {e}");
        }
    }

    pub fn surface_under(&self, pos: Point<f64, Logical>) -> Option<(WlSurface, Point<f64, Logical>)> {
        self.space.element_under(pos).and_then(|(window, location)| {
            window
                .surface_under(pos - location.to_f64(), WindowSurfaceType::ALL)
                .map(|(s, p)| (s, (p + location).to_f64()))
        })
    }
}

/// Data associated with a wayland client that connects to Smallvil.
/// One instance of this type per client.
#[derive(Default)]
pub struct ClientState {
    pub compositor_state: CompositorClientState,
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}
