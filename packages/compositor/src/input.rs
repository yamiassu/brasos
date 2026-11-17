use smithay::{
    backend::input::{
        AbsolutePositionEvent, Axis, AxisSource, ButtonState, Event, InputBackend, InputEvent, KeyState,
        KeyboardKeyEvent, PointerAxisEvent, PointerButtonEvent, PointerMotionEvent,
    },
    input::{
        keyboard::{FilterResult, Keysym},
        pointer::{AxisFrame, ButtonEvent, MotionEvent},
    },
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::SERIAL_COUNTER,
};

use crate::state::Smallvil;

impl Smallvil {
    pub fn process_input_event<I: InputBackend>(&mut self, event: InputEvent<I>) {
        match event {
            InputEvent::Keyboard { event, .. } => {
                let serial = SERIAL_COUNTER.next_serial();
                let time = Event::time(&event);

                // Alt+Tab moves the keyboard to the next window (the pointer can't always be used, and a window that
                // grabbed focus must never trap it); the compositor keeps that key for itself
                let pressed = event.state() == KeyState::Pressed;
                let action = self.seat.get_keyboard().unwrap().input::<u8, _>(
                    self,
                    event.key_code(),
                    event.state(),
                    serial,
                    time,
                    |_, m, h| match (m.alt, h.modified_sym()) {
                        (true, Keysym::Tab) => FilterResult::Intercept(if pressed { 1 } else { 0 }),
                        (true, Keysym::Escape) => FilterResult::Intercept(if pressed { 2 } else { 0 }), // Alt+Esc: back to the shell
                        _ => FilterResult::Forward,
                    },
                );
                match action {
                    Some(1) => self.cycle_focus(),
                    Some(2) => {
                        let shell = self.space.elements().find(|w| crate::state::is_shell(w)).cloned();
                        if let Some(s) = shell {
                            self.focus_window(&s);
                        }
                    }
                    _ => {}
                }
            }
            // a mouse (libinput): move the pointer by the delta, kept inside the output
            InputEvent::PointerMotion { event, .. } => {
                let Some(geo) = self.space.outputs().next().and_then(|o| self.space.output_geometry(o)) else { return };
                let pointer = self.seat.get_pointer().unwrap();
                let mut pos = pointer.current_location() + event.delta();
                pos.x = pos.x.clamp(geo.loc.x as f64, (geo.loc.x + geo.size.w - 1) as f64);
                pos.y = pos.y.clamp(geo.loc.y as f64, (geo.loc.y + geo.size.h - 1) as f64);
                let under = self.surface_under(pos);
                pointer.motion(self, under, &MotionEvent { location: pos, serial: SERIAL_COUNTER.next_serial(), time: event.time() });
                pointer.frame(self);
            }
            InputEvent::PointerMotionAbsolute { event, .. } => {
                let output = self.space.outputs().next().unwrap();

                let output_geo = self.space.output_geometry(output).unwrap();

                let pos = event.position_transformed(output_geo.size) + output_geo.loc.to_f64();

                let serial = SERIAL_COUNTER.next_serial();

                let pointer = self.seat.get_pointer().unwrap();

                let under = self.surface_under(pos);

                pointer.motion(
                    self,
                    under,
                    &MotionEvent {
                        location: pos,
                        serial,
                        time: event.time(),
                    },
                );
                pointer.frame(self);
            }
            InputEvent::PointerButton { event, .. } => {
                let pointer = self.seat.get_pointer().unwrap();
                let keyboard = self.seat.get_keyboard().unwrap();

                let serial = SERIAL_COUNTER.next_serial();

                let button = event.button_code();

                let button_state = event.state();

                if ButtonState::Pressed == button_state && !pointer.is_grabbed() {
                    if let Some((window, _loc)) = self
                        .space
                        .element_under(pointer.current_location())
                        .map(|(w, l)| (w.clone(), l))
                    {
                        self.focus_window(&window);
                    } else {
                        self.space.elements().for_each(|window| {
                            window.set_activated(false);
                            if let Some(t) = window.toplevel() {
                                t.send_pending_configure();
                            }
                        });
                        keyboard.set_focus(self, Option::<WlSurface>::None, serial);
                    }
                };

                pointer.button(
                    self,
                    &ButtonEvent {
                        button,
                        state: button_state,
                        serial,
                        time: event.time(),
                    },
                );
                pointer.frame(self);
            }
            InputEvent::PointerAxis { event, .. } => {
                let source = event.source();

                let horizontal_amount = event
                    .amount(Axis::Horizontal)
                    .unwrap_or_else(|| event.amount_v120(Axis::Horizontal).unwrap_or(0.0) * 15.0 / 120.);
                let vertical_amount = event
                    .amount(Axis::Vertical)
                    .unwrap_or_else(|| event.amount_v120(Axis::Vertical).unwrap_or(0.0) * 15.0 / 120.);
                let horizontal_amount_discrete = event.amount_v120(Axis::Horizontal);
                let vertical_amount_discrete = event.amount_v120(Axis::Vertical);

                let mut frame = AxisFrame::new(event.time()).source(source);
                if horizontal_amount != 0.0 {
                    frame = frame.value(Axis::Horizontal, horizontal_amount);
                    if let Some(discrete) = horizontal_amount_discrete {
                        frame = frame.v120(Axis::Horizontal, discrete as i32);
                    }
                }
                if vertical_amount != 0.0 {
                    frame = frame.value(Axis::Vertical, vertical_amount);
                    if let Some(discrete) = vertical_amount_discrete {
                        frame = frame.v120(Axis::Vertical, discrete as i32);
                    }
                }

                if source == AxisSource::Finger {
                    if event.amount(Axis::Horizontal) == Some(0.0) {
                        frame = frame.stop(Axis::Horizontal);
                    }
                    if event.amount(Axis::Vertical) == Some(0.0) {
                        frame = frame.stop(Axis::Vertical);
                    }
                }

                let pointer = self.seat.get_pointer().unwrap();
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            _ => {}
        }
    }
}
