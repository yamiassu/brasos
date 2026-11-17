#![allow(irrefutable_let_patterns)]

mod handlers;

mod ctl;
mod drm;
mod grabs;
mod headless;
mod input;
mod state;
mod winit;

use smithay::reexports::{calloop::EventLoop, wayland_server::Display};
pub use state::Smallvil;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_logging();

    let mut event_loop: EventLoop<Smallvil> = EventLoop::try_new()?;

    let display: Display<Smallvil> = Display::new()?;

    let mut state = Smallvil::new(&mut event_loop, display);

    // the shell asks for native windows here (packages/native); without it the compositor still works
    if let Ok(path) = std::env::var("BRASOS_COMP_SOCKET") {
        match ctl::init(&mut event_loop, &path) {
            Ok(c) => state.ctl = Some(c),
            Err(e) => eprintln!("brasos-comp: control socket {path}: {e}"),
        }
    }

    // `--drm` (or BRASOS_BACKEND=drm): own the display. Otherwise a nested window, for running inside cage or another compositor.
    if std::env::var("BRASOS_BACKEND").as_deref() == Ok("headless") {
        crate::headless::init(&mut state);
    } else if std::env::args().any(|a| a == "--drm") || std::env::var("BRASOS_BACKEND").as_deref() == Ok("drm") {
        crate::drm::init(&mut event_loop, &mut state)?;
    } else {
        crate::winit::init_winit(&mut event_loop, &mut state)?;
    }

    // X11 apps (BRASOS_XWAYLAND=1, set by the image when an app needs it): Xwayland's output goes next to the control socket
    if std::env::var("BRASOS_XWAYLAND").as_deref() == Ok("1") {
        let log = std::env::var("BRASOS_COMP_SOCKET")
            .ok()
            .and_then(|p| std::path::Path::new(&p).parent().map(|d| d.join("xwayland.log")))
            .and_then(|p| std::fs::File::create(p).ok());
        state.start_xwayland(log);
    }

    // Set WAYLAND_DISPLAY to our socket name, so child processes connect to Smallvil rather
    // than the host compositor
    unsafe { std::env::set_var("WAYLAND_DISPLAY", &state.socket_name) };

    // Spawn a test client, that will run under Smallvil
    spawn_client();

    event_loop.run(None, &mut state, move |_| {
        // Smallvil is running
    })?;

    Ok(())
}

fn init_logging() {
    if let Ok(env_filter) = tracing_subscriber::EnvFilter::try_from_default_env() {
        tracing_subscriber::fmt().with_env_filter(env_filter).init();
    } else {
        tracing_subscriber::fmt().init();
    }
}

/// every `-c <command line>` starts one client (through `sh -c`), so Chromium and native apps can run side by side
fn spawn_client() {
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        if flag == "--drm" {
            continue;
        }
        if let ("-c" | "--command", Some(command)) = (flag.as_str(), args.next()) {
            std::process::Command::new("sh").arg("-c").arg(command).spawn().ok();
        }
    }
}
