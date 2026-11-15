// The shell's view of native windows: a Unix socket speaking one JSON object per line.
//   compositor -> client: {"windows":[{"id":3,"title":"…","app":"foot","focused":true}]}   (on connect, and on every change)
//   client -> compositor: {"focus":3}  or  {"close":3}
// The socket is 0600 and owned by the session user, so only that user's host can drive windows. The host gates who may ask it
// (see packages/native); nothing here trusts the line beyond "an id of a window that exists".
use std::{
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, net::{UnixListener, UnixStream}},
    time::Duration,
};

use smithay::{
    desktop::Window,
    reexports::calloop::{
        EventLoop,
        timer::{TimeoutAction, Timer},
    },
    reexports::wayland_server::Resource,
    utils::SERIAL_COUNTER,
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use crate::state::Smallvil;

pub struct Ctl {
    listener: UnixListener,
    clients: Vec<(UnixStream, Vec<u8>)>,
    last: String,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push(' '),
            c => o.push(c),
        }
    }
    o
}

fn id_of(w: &Window) -> u32 {
    w.toplevel().map(|t| t.wl_surface().id().protocol_id()).unwrap_or(0)
}

/// `{"focus":3}` -> ("focus", 3); anything else is ignored
fn parse(line: &str) -> Option<(&str, u32)> {
    let l = line.trim().strip_prefix('{')?.strip_suffix('}')?;
    let (k, v) = l.split_once(':')?;
    let k = k.trim().trim_matches('"');
    (k == "focus" || k == "close").then(|| v.trim().parse().ok().map(|n| (k, n)))?
}

pub fn init(event_loop: &mut EventLoop<Smallvil>, path: &str) -> std::io::Result<Ctl> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    listener.set_nonblocking(true)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    event_loop
        .handle()
        .insert_source(Timer::from_duration(Duration::from_millis(100)), |_, _, state| {
            state.poll_ctl();
            TimeoutAction::ToDuration(Duration::from_millis(100))
        })
        .expect("ctl timer");
    Ok(Ctl { listener, clients: vec![], last: String::new() })
}

impl Smallvil {
    fn windows_json(&self) -> String {
        let focus = self.seat.get_keyboard().and_then(|k| k.current_focus());
        let items: Vec<String> = self
            .space
            .elements()
            .filter_map(|w| {
                let t = w.toplevel()?;
                let (title, app) = with_states(t.wl_surface(), |s| {
                    let a = s.data_map.get::<XdgToplevelSurfaceData>().unwrap().lock().unwrap();
                    (a.title.clone().unwrap_or_default(), a.app_id.clone().unwrap_or_default())
                });
                let focused = focus.as_ref() == Some(t.wl_surface());
                Some(format!("{{\"id\":{},\"title\":\"{}\",\"app\":\"{}\",\"focused\":{}}}", id_of(w), esc(&title), esc(&app), focused))
            })
            .collect();
        format!("{{\"windows\":[{}]}}\n", items.join(","))
    }

    fn poll_ctl(&mut self) {
        let Some(mut ctl) = self.ctl.take() else { return };
        while let Ok((s, _)) = ctl.listener.accept() {
            s.set_nonblocking(true).ok();
            ctl.clients.push((s, vec![]));
            ctl.last.clear(); // a new client gets the current list
        }
        let mut cmds = vec![];
        ctl.clients.retain_mut(|(s, buf)| {
            let mut chunk = [0u8; 256];
            loop {
                match s.read(&mut chunk) {
                    Ok(0) => return false,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(_) => return false,
                }
            }
            if buf.len() > 4096 {
                return false; // not a protocol speaker
            }
            while let Some(i) = buf.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buf.drain(..=i).collect();
                if let Some((k, n)) = parse(&String::from_utf8_lossy(&line)) {
                    cmds.push((k.to_string(), n));
                }
            }
            true
        });
        for (k, id) in cmds {
            let Some(w) = self.space.elements().find(|w| id_of(w) == id).cloned() else { continue };
            let t = w.toplevel().unwrap().clone();
            if k == "close" {
                t.send_close();
            } else {
                self.space.raise_element(&w, true);
                if let Some(kb) = self.seat.get_keyboard() {
                    kb.set_focus(self, Some(t.wl_surface().clone()), SERIAL_COUNTER.next_serial());
                }
            }
        }
        let now = self.windows_json();
        if now != ctl.last || ctl.clients.is_empty() {
            if now != ctl.last {
                ctl.clients.retain_mut(|(s, _)| s.write_all(now.as_bytes()).is_ok());
            }
            ctl.last = now;
        }
        self.ctl = Some(ctl);
    }
}
