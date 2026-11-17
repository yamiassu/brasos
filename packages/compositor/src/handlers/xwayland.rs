// X11 windows (Xwayland), managed like any other window: tiled by `retile`, listed to the shell, focusable and closable.
// Override-redirect windows (menus, tooltips) place themselves. Clipboard between X11 and Wayland is not bridged yet.
use std::os::unix::io::OwnedFd;

use smithay::{
    desktop::Window,
    utils::{Logical, Rectangle},
    wayland::{
        selection::SelectionTarget,
        xwayland_shell::{XWaylandShellHandler, XWaylandShellState},
    },
    xwayland::{
        X11Surface, X11Wm, XwmHandler,
        xwm::{Reorder, ResizeEdge, XwmId},
    },
};

use crate::Smallvil;

impl XWaylandShellHandler for Smallvil {
    fn xwayland_shell_state(&mut self) -> &mut XWaylandShellState {
        &mut self.xwayland_shell_state
    }
}

impl Smallvil {
    fn x11_element(&self, window: &X11Surface) -> Option<Window> {
        self.space.elements().find(|e| e.x11_surface().is_some_and(|w| w == window)).cloned()
    }
}

impl XwmHandler for Smallvil {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        self.xwm.as_mut().expect("xwm")
    }

    fn new_window(&mut self, _xwm: XwmId, _window: X11Surface) {}
    fn new_override_redirect_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn map_window_request(&mut self, _xwm: XwmId, window: X11Surface) {
        let _ = window.set_mapped(true);
        let size = window.geometry().size;
        let _ = window.configure(Rectangle::new((60, 60).into(), if size.w > 0 && size.h > 0 { size } else { (800, 600).into() }));
        self.space.map_element(Window::new_x11_window(window), (60, 60), true);
    }

    fn mapped_override_redirect_window(&mut self, _xwm: XwmId, window: X11Surface) {
        let loc = window.geometry().loc;
        self.space.map_element(Window::new_x11_window(window), loc, true);
    }

    fn unmapped_window(&mut self, _xwm: XwmId, window: X11Surface) {
        if let Some(e) = self.x11_element(&window) {
            self.space.unmap_elem(&e);
        }
        if !window.is_override_redirect() {
            let _ = window.set_mapped(false);
        }
    }

    fn destroyed_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    // the compositor owns placement: a window may ask for a size, never a position
    fn configure_request(&mut self, _xwm: XwmId, window: X11Surface, _x: Option<i32>, _y: Option<i32>, w: Option<u32>, h: Option<u32>, _reorder: Option<Reorder>) {
        if window.is_override_redirect() {
            let mut geo = window.geometry();
            if let Some(w) = w {
                geo.size.w = w as i32;
            }
            if let Some(h) = h {
                geo.size.h = h as i32;
            }
            let _ = window.configure(geo);
        } else {
            // a managed window may resize itself; where it sits is the shell's decision
            let loc = self.x11_element(&window).and_then(|e| self.space.element_location(&e)).unwrap_or((60, 60).into());
            let mut size = window.geometry().size;
            if let Some(w) = w {
                size.w = w as i32;
            }
            if let Some(h) = h {
                size.h = h as i32;
            }
            let _ = window.configure(Rectangle::new(loc, size));
        }
    }

    fn configure_notify(&mut self, _xwm: XwmId, window: X11Surface, geometry: Rectangle<i32, Logical>, _above: Option<u32>) {
        if window.is_override_redirect() {
            if let Some(e) = self.x11_element(&window) {
                self.space.map_element(e, geometry.loc, false);
            }
        }
    }

    fn resize_request(&mut self, _xwm: XwmId, _window: X11Surface, _button: u32, _edges: ResizeEdge) {}
    // an X11 app that draws its own title bar (Steam) asks to be moved when its bar is dragged: the compositor runs the move
    fn move_request(&mut self, _xwm: XwmId, window: X11Surface, _button: u32) {
        use smithay::input::pointer::Focus;
        let Some(el) = self.x11_element(&window) else { return };
        let Some(pointer) = self.seat.get_pointer() else { return };
        let Some(start_data) = pointer.grab_start_data() else { return };
        let Some(loc) = self.space.element_location(&el) else { return };
        let grab = crate::grabs::MoveSurfaceGrab { start_data, window: el, initial_window_location: loc };
        pointer.set_grab(self, grab, smithay::utils::SERIAL_COUNTER.next_serial(), Focus::Clear);
    }
    fn maximize_request(&mut self, _xwm: XwmId, _window: X11Surface) {}
    fn unmaximize_request(&mut self, _xwm: XwmId, _window: X11Surface) {}
    fn fullscreen_request(&mut self, _xwm: XwmId, window: X11Surface) {
        // "fullscreen" keeps the tile, as for Wayland clients (see xdg_shell)
        let _ = window.set_fullscreen(true);
    }
    fn unfullscreen_request(&mut self, _xwm: XwmId, window: X11Surface) {
        let _ = window.set_fullscreen(false);
    }

    fn send_selection(&mut self, _xwm: XwmId, _selection: SelectionTarget, _mime_type: String, _fd: OwnedFd) {}
    fn new_selection(&mut self, _xwm: XwmId, _selection: SelectionTarget, _mime_types: Vec<String>) {}
    fn cleared_selection(&mut self, _xwm: XwmId, _selection: SelectionTarget) {}

    fn disconnected(&mut self, _xwm: XwmId) {
        self.xwm = None;
        self.xdisplay = None;
    }
}
