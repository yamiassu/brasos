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
    apps: Vec<App>,
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

/// unique across clients (protocol ids restart at 1 per client): a hash of the full object id, never 0
fn id_of(w: &Window) -> u32 {
    use std::hash::{Hash, Hasher};
    let Some(t) = w.toplevel() else { return 0 };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    t.wl_surface().id().hash(&mut h);
    (h.finish() as u32).max(1)
}

enum Cmd {
    Focus(u32),
    Close(u32),
    Launch(String),
}

/// `{"focus":3}`, `{"close":3}`, `{"launch":"foot"}`; anything else is ignored
fn parse(line: &str) -> Option<Cmd> {
    let l = line.trim().strip_prefix('{')?.strip_suffix('}')?;
    let (k, v) = l.split_once(':')?;
    let (k, v) = (k.trim().trim_matches('"'), v.trim());
    match k {
        "focus" => v.parse().ok().map(Cmd::Focus),
        "close" => v.parse().ok().map(Cmd::Close),
        "launch" => {
            let id = v.trim_matches('"');
            (!id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')).then(|| Cmd::Launch(id.to_string()))
        }
        _ => None,
    }
}

/// A native app from the image: started only by id, inside bubblewrap (no home, no network unless the image says so, no access
/// to the control socket or the rest of /run). The list is a file the image owns (BRASOS_NATIVE_APPS): `id<TAB>net<TAB>argv`,
/// argv separated by 0x1f. The host never sends a command line, only an id.
pub struct App {
    id: String,
    net: bool,
    argv: Vec<String>,
}

pub fn load_apps() -> Vec<App> {
    let Ok(text) = std::env::var("BRASOS_NATIVE_APPS").map(std::fs::read_to_string).unwrap_or(Ok(String::new())) else { return vec![] };
    text.lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\t');
            let (id, net, argv) = (f.next()?, f.next()?, f.next()?);
            let argv: Vec<String> = argv.split('\x1f').map(String::from).collect();
            (!argv.is_empty() && !argv[0].is_empty()).then(|| App { id: id.into(), net: net == "1", argv })
        })
        .collect()
}

fn spawn_sandboxed(app: &App, wayland_display: &str) {
    let xdg = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/run/user/1000".into());
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/brasos".into());
    let sock = format!("{xdg}/{wayland_display}");
    let mut c = std::process::Command::new(std::env::var("BRASOS_BWRAP").unwrap_or_else(|_| "bwrap".into()));
    c.args(["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"]);
    if app.net {
        c.arg("--share-net");
    }
    c.args(["--ro-bind", "/nix/store", "/nix/store", "--ro-bind", "/etc", "/etc", "--ro-bind-try", "/run/current-system", "/run/current-system"])
        .args(["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", &home, "--dir", &xdg, "--bind", &sock, &sock])
        .args(["--setenv", "XDG_RUNTIME_DIR", &xdg, "--setenv", "WAYLAND_DISPLAY", wayland_display, "--setenv", "HOME", &home])
        .args(["--setenv", "PATH", "/run/current-system/sw/bin", "--setenv", "TERM", "xterm-256color", "--"])
        .args(&app.argv);
    if let Err(e) = c.spawn() {
        eprintln!("brasos-comp: launch {}: {e}", app.id);
    }
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
    Ok(Ctl { apps: load_apps(), listener, clients: vec![], last: String::new() })
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
                if let Some(c) = parse(&String::from_utf8_lossy(&line)) {
                    cmds.push(c);
                }
            }
            true
        });
        for c in cmds {
            let close = matches!(c, Cmd::Close(_));
            let id = match c {
                Cmd::Launch(app) => {
                    if let Some(a) = ctl.apps.iter().find(|a| a.id == app) {
                        spawn_sandboxed(a, &self.socket_name.to_string_lossy());
                        self.focus_next = true;
                    }
                    continue;
                }
                Cmd::Focus(id) | Cmd::Close(id) => id,
            };
            let Some(w) = self.space.elements().find(|w| id_of(w) == id).cloned() else { continue };
            let t = w.toplevel().unwrap().clone();
            if close {
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
