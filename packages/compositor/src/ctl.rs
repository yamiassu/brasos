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
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use crate::state::Smallvil;

pub struct Ctl {
    apps: Vec<App>,
    listener: UnixListener,
    clients: Vec<(UnixStream, Vec<u8>)>,
    last: String,
    tick: u32,
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
    let Some(s) = crate::state::wl_of(w) else { return 0 };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.id().hash(&mut h);
    (h.finish() as u32).max(1)
}

enum Cmd {
    Focus(u32),
    Close(u32),
    Launch(String),
    /// an app that takes one web address (flag `u`): id, url
    Open(String, String),
    /// an app id handed to an app that runs other apps by id (the Flatpak runner)
    Run(String, String),
    /// id, x, y, w, h: where a window's content goes (the shell draws the frame around it)
    Place(u32, i32, i32, i32, i32),
    /// a small picture of a window (answered on the same connection, see `thumb_reply`)
    Thumb(u32),
}

/// A web address that may be handed to a native app as its last argument: http(s) only, bounded, and only URL characters (no quote,
/// backslash, space or control character), so it can't be mistaken for an option or break the command line.
pub fn safe_url(u: &str) -> bool {
    (u.starts_with("http://") || u.starts_with("https://"))
        && u.len() <= 2048
        && u.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&b))
}

/// A Flatpak application id (reverse DNS: `com.valvesoftware.Steam`): at least three dot-separated parts of letters, digits, `_` and `-`,
/// starting with a letter, so it can never be taken for an option or carry anything else onto the command line.
pub fn safe_app_id(a: &str) -> bool {
    a.len() <= 150
        && a.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
        && a.split('.').count() >= 3
        && a.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
}

/// `{"focus":3}`, `{"close":3}`, `{"launch":"foot"}`, `{"open":"web","url":"https://..."}`, `{"run":"flatpak","app":"com.x.Y"}`; anything else is ignored
fn parse(line: &str) -> Option<Cmd> {
    if let Some(r) = line.trim().strip_prefix("{\"run\":\"").and_then(|r| r.strip_suffix("\"}")) {
        let (id, app) = r.split_once("\",\"app\":\"")?;
        let id_ok = !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        return (id_ok && safe_app_id(app)).then(|| Cmd::Run(id.to_string(), app.to_string()));
    }
    if let Some(r) = line.trim().strip_prefix("{\"open\":\"").and_then(|r| r.strip_suffix("\"}")) {
        let (id, url) = r.split_once("\",\"url\":\"")?;
        let id_ok = !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        return (id_ok && safe_url(url)).then(|| Cmd::Open(id.to_string(), url.to_string()));
    }
    if let Some(v) = line.trim().strip_prefix("{\"place\":[").and_then(|r| r.strip_suffix("]}")) {
        // window ids are u32 hashes (more than i32 can hold)
        let n: Vec<i64> = v.split(',').filter_map(|x| x.trim().parse().ok()).collect();
        return match n[..] {
            [id, x, y, w, h] if (1..=u32::MAX as i64).contains(&id) && (64..=16384).contains(&w) && (48..=16384).contains(&h) && x.abs() <= 16384 && y.abs() <= 16384 => {
                Some(Cmd::Place(id as u32, x as i32, y as i32, w as i32, h as i32))
            }
            _ => None,
        };
    }
    let l = line.trim().strip_prefix('{')?.strip_suffix('}')?;
    let (k, v) = l.split_once(':')?;
    let (k, v) = (k.trim().trim_matches('"'), v.trim());
    match k {
        "focus" => v.parse().ok().map(Cmd::Focus),
        "close" => v.parse().ok().map(Cmd::Close),
        "thumb" => v.parse().ok().filter(|id| *id >= 1).map(Cmd::Thumb),
        "launch" => {
            let id = v.trim_matches('"');
            (!id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')).then(|| Cmd::Launch(id.to_string()))
        }
        _ => None,
    }
}

/// A native app from the image: started only by id. By default inside bubblewrap (no home, no network unless the image says so,
/// no access to the control socket or the rest of /run); an app the image marks `open` (Steam: it needs a persistent home, GPU
/// devices and its own sandboxing) runs as a plain user process. The list is a file the image owns (BRASOS_NATIVE_APPS):
/// `id<TAB>flags<TAB>argv`, flags a string of `n` (network), `o` (open: no sandbox) and `u` (takes one web address as its last argument) or `-`, argv separated by 0x1f.
/// The host never sends a command line, only an id.
pub struct App {
    id: String,
    net: bool,
    open: bool,
    url: bool,
    /// the address is given as `--app=<address>` (a Chromium app window) instead of after `--` (flag `w`); only with `url`
    appmode: bool,
    /// takes one application id as its last argument (the Flatpak runner); only for an `open` app
    run: bool,
    argv: Vec<String>,
}

pub fn load_apps() -> Vec<App> {
    let Ok(text) = std::env::var("BRASOS_NATIVE_APPS").map(std::fs::read_to_string).unwrap_or(Ok(String::new())) else { return vec![] };
    parse_apps(&text)
}

fn parse_apps(text: &str) -> Vec<App> {
    text.lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\t');
            let (id, flags, argv) = (f.next()?, f.next()?, f.next()?);
            let argv: Vec<String> = argv.split('\x1f').map(String::from).collect();
            (!argv.is_empty() && !argv[0].is_empty()).then(|| App { id: id.into(), net: flags.contains('n'), open: flags.contains('o'), url: flags.contains('u'), appmode: flags.contains('w') && flags.contains('u'), run: flags.contains('a') && flags.contains('o'), argv })
        })
        .collect()
}

/// where an app's stdout/stderr go: next to the control socket (a directory only the session user can enter), one file per app
fn log_of(app: &App) -> (std::process::Stdio, std::process::Stdio) {
    let dir = std::env::var("BRASOS_COMP_SOCKET").ok().and_then(|p| std::path::Path::new(&p).parent().map(|d| d.to_path_buf()));
    match dir.and_then(|d| std::fs::File::create(d.join(format!("{}.log", app.id))).ok()) {
        Some(f) => match f.try_clone() {
            Ok(g) => (f.into(), g.into()),
            Err(_) => (f.into(), std::process::Stdio::null()),
        },
        None => (std::process::Stdio::null(), std::process::Stdio::null()),
    }
}

/// NixOS logins carry an ambient capability (CAP_WAKE_ALARM, from pam_cap) that children inherit; bubblewrap refuses to start
/// with any ("Unexpected capabilities but not setuid"), and so does the bubblewrap Steam runs inside. A native app needs none:
/// clear the ambient set in the child, so after exec it holds no capabilities.
fn without_ambient_caps(c: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: only async-signal-safe work (one prctl) between fork and exec
    unsafe {
        c.pre_exec(|| {
            libc::prctl(libc::PR_CAP_AMBIENT, libc::PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0);
            Ok(())
        });
    }
}

/// How a web address reaches the command line: after `--` (a plain address, never an option), or as the single argument `--app=<address>` for
/// an app window. The address has already passed `safe_url`, so it can't carry a space, a quote or a second option either way.
fn url_args(app: &App, u: &str) -> Vec<String> {
    if app.appmode { vec![format!("--app={u}")] } else { vec!["--".into(), u.into()] }
}

fn spawn_app(app: &App, wayland_display: &str, xdisplay: Option<u32>, url: Option<&str>, run: Option<&str>) {
    let xdg = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/run/user/1000".into());
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/brasos".into());
    let (out, err) = log_of(app);
    if app.open {
        // not sandboxed: the app sees the user's home and processes, so the image must opt in and hardened never ships one
        let mut c = std::process::Command::new(&app.argv[0]);
        c.args(&app.argv[1..]).env("WAYLAND_DISPLAY", wayland_display).stdout(out).stderr(err);
        if let Some(u) = url {
            c.args(url_args(app, u)); // after `--`: an address, never an option (or the one `--app=` argument)
        }
        if let Some(a) = run {
            c.arg(a); // a checked application id (letters first, no `-` lead): never an option
        }
        without_ambient_caps(&mut c);
        if let Some(n) = xdisplay {
            c.env("DISPLAY", format!(":{n}"));
        }
        reaped(c.spawn(), &app.id);
        return;
    }
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
        .args(&app.argv)
        .args(url.map(|u| url_args(app, u)).unwrap_or_default())
        .stdout(out)
        .stderr(err);
    without_ambient_caps(&mut c);
    reaped(c.spawn(), &app.id);
}

/// a child nobody waits for stays a zombie: wait for it on its own thread
fn reaped(child: std::io::Result<std::process::Child>, id: &str) {
    match child {
        Ok(mut c) => {
            std::thread::spawn(move || {
                let _ = c.wait();
            });
        }
        Err(e) => eprintln!("brasos-comp: launch {id}: {e}"),
    }
}

pub fn init(event_loop: &mut EventLoop<Smallvil>, path: &str) -> std::io::Result<Ctl> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    listener.set_nonblocking(true)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    event_loop
        .handle()
        .insert_source(Timer::from_duration(Duration::from_millis(8)), |_, _, state| {
            state.poll_ctl();
            TimeoutAction::ToDuration(Duration::from_millis(8))
        })
        .expect("ctl timer");
    Ok(Ctl { apps: load_apps(), listener, clients: vec![], last: String::new(), tick: 0 })
}

impl Smallvil {
    fn windows_json(&self) -> String {
        let focus = self.seat.get_keyboard().and_then(|k| k.current_focus());
        let items: Vec<String> = self
            .space
            .elements()
            .filter_map(|w| {
                let surface = crate::state::wl_of(w)?;
                let (title, app) = if let Some(x) = w.x11_surface() {
                    if x.is_override_redirect() {
                        return None; // menus and tooltips are not windows to list
                    }
                    (x.title(), x.class())
                } else {
                    with_states(&surface, |s| {
                        let a = s.data_map.get::<XdgToplevelSurfaceData>().unwrap().lock().unwrap();
                        (a.title.clone().unwrap_or_default(), a.app_id.clone().unwrap_or_default())
                    })
                };
                let focused = focus.as_ref() == Some(&surface);
                if crate::state::is_shell(w) {
                    return None; // the shell is not an app window
                }
                let size = w.geometry().size;
                let at = self.space.element_location(w).unwrap_or_default();
                // does the shell draw this window's title bar? Only if the app doesn't: an X11 app says so in its hints, a Wayland app
                // by negotiating server-side decoration (xdg-decoration); GTK, Qt and Electron apps without it draw their own
                let ssd = match w.x11_surface() {
                    Some(x) => !x.is_decorated(),
                    None => with_states(&surface, |s| s.data_map.get::<crate::handlers::SsdMarker>().is_some()),
                };
                Some(format!("{{\"id\":{},\"title\":\"{}\",\"app\":\"{}\",\"focused\":{},\"w\":{},\"h\":{},\"ssd\":{},\"x\":{},\"y\":{}}}", id_of(w), esc(&title), esc(&app), focused, size.w, size.h, ssd, at.x + w.geometry().loc.x, at.y + w.geometry().loc.y))
            })
            .collect();
        format!("{{\"windows\":[{}]}}\n", items.join(","))
    }

    /// `{"thumb":ID,"w":W,"h":H,"rgb":"<base64>"}` for the window's last shared-memory buffer shrunk to at most 224 x 140, or
    /// `{"thumb":ID,"error":"…"}`. A window that draws with the GPU (dmabuf) has no buffer to read here: the shell shows its icon then.
    fn thumb_reply(&self, id: u32) -> String {
        use smithay::reexports::wayland_server::protocol::wl_shm::Format;
        let fail = |m: &str| format!("{{\"thumb\":{id},\"error\":\"{m}\"}}\n");
        let Some(win) = self.space.elements().find(|w| id_of(w) == id && !crate::state::is_shell(w)) else { return fail("no such window") };
        let Some(surface) = crate::state::wl_of(win) else { return fail("no surface") };
        let shot = smithay::backend::renderer::utils::with_renderer_surface_state(&surface, |st| {
            let buf = st.buffer()?;
            smithay::wayland::shm::with_buffer_contents(buf, |ptr, len, d| {
                let (rgba_order, alpha) = match d.format {
                    Format::Argb8888 => (false, true),
                    Format::Xrgb8888 => (false, false),
                    Format::Abgr8888 => (true, true),
                    Format::Xbgr8888 => (true, false),
                    _ => return None,
                };
                // the pool is mapped for the call only: read it here, inside
                let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
                let (w, h, stride, offset) = (usize::try_from(d.width).ok()?, usize::try_from(d.height).ok()?, usize::try_from(d.stride).ok()?, usize::try_from(d.offset).ok()?);
                crate::thumb::downscale(&crate::thumb::Src { bytes, offset, w, h, stride, rgba_order, alpha }, crate::thumb::MAX_W, crate::thumb::MAX_H)
            })
            .ok()
            .flatten()
        });
        match shot.flatten() {
            Some((w, h, rgb)) => format!("{{\"thumb\":{id},\"w\":{w},\"h\":{h},\"rgb\":\"{}\"}}\n", crate::thumb::base64(&rgb)),
            None => fail("not readable"),
        }
    }

    /// move a native window and give it the size the shell's frame leaves for its content
    fn place_window(&mut self, win: &Window, x: i32, y: i32, w: i32, h: i32) {
        if let Some(t) = win.toplevel() {
            t.with_pending_state(|s| s.size = Some((w, h).into()));
            t.send_pending_configure();
        } else if let Some(x11) = win.x11_surface() {
            let _ = x11.configure(smithay::utils::Rectangle::new((x, y).into(), (w, h).into()));
        }
        // `map_element` places the surface origin; a client that draws shadows around itself has its geometry offset inside it
        let off = win.geometry().loc;
        self.space.map_element(win.clone(), (x - off.x, y - off.y), false);
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
            let mut open = true; // a one-shot sender writes its line and hangs up: parse what it sent, then drop it
            loop {
                match s.read(&mut chunk) {
                    Ok(0) => {
                        open = false;
                        break;
                    }
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
                match parse(&String::from_utf8_lossy(&line)) {
                    // a picture is asked for on a connection that waits for the answer: write it back here, to this client only
                    Some(Cmd::Thumb(id)) => {
                        let reply = self.thumb_reply(id);
                        s.set_nonblocking(false).ok();
                        s.set_write_timeout(Some(Duration::from_millis(300))).ok();
                        let _ = s.write_all(reply.as_bytes());
                        s.set_nonblocking(true).ok();
                    }
                    Some(c) => cmds.push(c),
                    None => {}
                }
            }
            open
        });
        // commands are read every 8 ms (a drag sends many `place`s and the window must follow the frame); the window list that
        // goes back to the shell is rebuilt every ~100 ms and right after a command
        ctl.tick = ctl.tick.wrapping_add(1);
        let rebuild = !cmds.is_empty() || ctl.tick % 12 == 0 || ctl.last.is_empty();
        for c in cmds {
            let close = matches!(c, Cmd::Close(_));
            let id = match c {
                Cmd::Launch(app) => {
                    if let Some(a) = ctl.apps.iter().find(|a| a.id == app) {
                        spawn_app(a, &self.socket_name.to_string_lossy(), self.xdisplay, None, None);
                        self.focus_next = true;
                    }
                    continue;
                }
                Cmd::Open(app, url) => {
                    // only an app the image marked `u` takes an address, and only one that passed `safe_url`
                    if let Some(a) = ctl.apps.iter().find(|a| a.id == app && a.url) {
                        spawn_app(a, &self.socket_name.to_string_lossy(), self.xdisplay, Some(&url), None);
                        self.focus_next = true;
                    }
                    continue;
                }
                Cmd::Run(app, id) => {
                    // only an app the image marked `a` (and `o`) takes an application id, and only one that passed `safe_app_id`
                    if let Some(a) = ctl.apps.iter().find(|a| a.id == app && a.run) {
                        spawn_app(a, &self.socket_name.to_string_lossy(), self.xdisplay, None, Some(&id));
                        self.focus_next = true;
                    }
                    continue;
                }
                Cmd::Place(id, x, y, w, h) => {
                    let found = self.space.elements().find(|e| id_of(e) == id && !crate::state::is_shell(e)).cloned();
                    if let Some(win) = found {
                        self.place_window(&win, x, y, w, h);
                    }
                    continue;
                }
                Cmd::Thumb(_) => continue, // answered while reading
                Cmd::Focus(id) | Cmd::Close(id) => id,
            };
            let Some(w) = self.space.elements().find(|w| id_of(w) == id && !crate::state::is_shell(w)).cloned() else { continue };
            if close {
                if let Some(t) = w.toplevel() {
                    t.send_close();
                } else if let Some(x) = w.x11_surface() {
                    let _ = x.close();
                }
            } else {
                self.focus_window(&w);
            }
        }
        if !rebuild {
            self.ctl = Some(ctl);
            return;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_file_flags() {
        let apps = parse_apps("foot\t-\t/bin/foot\nsteam\tno\t/bin/steam\x1f-bigpicture\nbad\n\tn\t\n");
        assert_eq!(apps.len(), 2);
        assert!(!apps[0].net && !apps[0].open);
        assert!(apps[1].net && apps[1].open);
        assert_eq!(apps[1].argv, ["/bin/steam", "-bigpicture"]);
    }

    #[test]
    fn commands_only_by_known_shape() {
        assert!(matches!(parse("{\"launch\":\"steam\"}"), Some(Cmd::Launch(_))));
        assert!(parse("{\"launch\":\"../x\"}").is_none());
        assert!(parse("{\"launch\":\"a b\"}").is_none());
        assert!(matches!(parse("{\"focus\":7}"), Some(Cmd::Focus(7))));
        assert!(matches!(parse("{\"thumb\":7}"), Some(Cmd::Thumb(7))));
        assert!(parse("{\"thumb\":0}").is_none());
        assert!(parse("{\"thumb\":\"7; rm\"}").is_none());
    }

    #[test]
    fn an_app_window_gets_its_address_as_one_app_argument() {
        let apps = parse_apps("web\tnou\t/bin/chromium\nwebapp\tnouw\t/bin/chromium\nfoot\tnw\t/bin/foot");
        assert_eq!(url_args(&apps[0], "https://a.b/c"), ["--", "https://a.b/c"]);
        assert_eq!(url_args(&apps[1], "https://a.b/c"), ["--app=https://a.b/c"]);
        assert!(apps[1].appmode && !apps[0].appmode);
        assert!(!apps[2].appmode); // `w` means nothing without `u`
    }

    #[test]
    fn open_takes_only_a_plain_web_address() {
        assert!(matches!(parse("{\"open\":\"web\",\"url\":\"https://example.com/a?b=c&d=1#x\"}"), Some(Cmd::Open(_, _))));
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "--remote-debugging-port=1", "https://a b", r"https://a\b","https://a\"b", "ftp://x"] {
            assert!(parse(&format!("{{\"open\":\"web\",\"url\":\"{bad}\"}}")).is_none(), "{bad}");
        }
        assert!(parse("{\"open\":\"../x\",\"url\":\"https://a.b\"}").is_none());
        assert!(!safe_url(&format!("https://a.b/{}", "x".repeat(2100))));
        assert!(parse_apps("web	nou	/bin/chromium")[0].url);
    }

    #[test]
    fn run_takes_only_a_reverse_dns_application_id() {
        assert!(matches!(parse("{\"run\":\"flatpak\",\"app\":\"com.valvesoftware.Steam\"}"), Some(Cmd::Run(_, _))));
        for bad in ["--help", "-x.y.z", "a.b", "a..b", "com.x.Y z", "com.x.Y;ls", "1com.x.Y", "com.x.Y/../z", ""] {
            assert!(!safe_app_id(bad), "{bad}");
        }
        assert!(parse("{\"run\":\"flatpak\",\"app\":\"--user\"}").is_none());
        assert!(!safe_app_id(&format!("com.x.{}", "y".repeat(160))));
    }

    #[test]
    fn place_is_five_bounded_integers() {
        assert!(matches!(parse("{\"place\":[5,10,-20,800,600]}"), Some(Cmd::Place(5, 10, -20, 800, 600))));
        assert!(parse("{\"place\":[5,10,-20,800]}").is_none());
        assert!(parse("{\"place\":[0,1,1,800,600]}").is_none());
        assert!(parse("{\"place\":[5,1,1,10,600]}").is_none());
        assert!(parse("{\"place\":[5,1,1,800,600,7]}").is_none());
        assert!(parse("{\"place\":[5,x,1,800,600]}").is_none());
        // an id above i32::MAX is a normal window id
        assert!(matches!(parse("{\"place\":[3999999999,1,2,800,600]}"), Some(Cmd::Place(3999999999, 1, 2, 800, 600))));
    }
}
