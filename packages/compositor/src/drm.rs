// The DRM/KMS backend: brasos-comp owns the display, the keyboard and the pointer (no cage, no nested window).
// Software path on purpose: dumb buffers scanned out, composited with pixman, so it runs on any GPU (or none, as in the test VM).
// A GPU path (GBM + EGL + GlesRenderer, as in smithay's anvil) is the next step and only changes the allocator and renderer.
use std::{cell::RefCell, rc::Rc, time::Duration};

use smithay::{
    backend::{
        allocator::{
            Fourcc,
            dumb::DumbAllocator,
            gbm::GbmDevice,
        },
        drm::{DrmDevice, DrmDeviceFd, DrmEvent, compositor::{DrmCompositor, FrameFlags}},
        libinput::{LibinputInputBackend, LibinputSessionInterface},
        renderer::{
            ImportDma,
            element::{Kind, memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement}, render_elements, surface::WaylandSurfaceRenderElement},
            pixman::PixmanRenderer,
        },
        session::{Event as SessionEvent, Session, libseat::LibSeatSession},
        udev::{all_gpus, primary_gpu},
    },
    desktop::{Window, space::{SpaceRenderElements, space_render_elements}},
    output::{Mode as WlMode, Output, PhysicalProperties, Subpixel},
    reexports::{
        calloop::{EventLoop, timer::{TimeoutAction, Timer}},
        drm::control::{Device as ControlDevice, ModeTypeFlags, connector},
        input::Libinput,
        rustix::fs::OFlags,
    },
    utils::{DeviceFd, Transform},
};

use crate::Smallvil;

render_elements! {
    Elem<=PixmanRenderer>;
    Space=SpaceRenderElements<PixmanRenderer, WaylandSurfaceRenderElement<PixmanRenderer>>,
    Cursor=MemoryRenderBufferRenderElement<PixmanRenderer>,
}

/// the pointer: a small arrow, drawn in software (no cursor plane on the dumb-buffer path)
fn arrow() -> MemoryRenderBuffer {
    const ART: [&str; 16] = [
        "X...........", "XX..........", "X#X.........", "X##X........", "X###X.......", "X####X......", "X#####X.....", "X######X....",
        "X#######X...", "X########X..", "X#####XXXXX.", "X##X##X.....", "X#X.X##X....", "XX..X##X....", "X....X##X...", ".....XXX....",
    ];
    let mut px = vec![0u8; 12 * 16 * 4];
    for (y, row) in ART.iter().enumerate() {
        for (x, c) in row.bytes().enumerate() {
            let v = match c { b'X' => 0u8, b'#' => 255, _ => continue };
            px[(y * 12 + x) * 4..][..4].copy_from_slice(&[v, v, v, 255]); // B, G, R, A (premultiplied, opaque)
        }
    }
    MemoryRenderBuffer::from_slice(&px, Fourcc::Argb8888, (12, 16), 1, Transform::Normal, None)
}

type Comp = DrmCompositor<DumbAllocator, DrmDeviceFd, (), DrmDeviceFd>;

struct Backend {
    drm: DrmDevice,
    compositor: Comp,
    renderer: PixmanRenderer,
    output: Output,
    cursor: MemoryRenderBuffer,
    queued: bool,
}

type Shared = Rc<RefCell<Backend>>;

fn render(be: &mut Backend, state: &mut Smallvil) {
    if be.queued {
        return;
    }
    let Ok(space) = space_render_elements::<_, Window, _>(&mut be.renderer, [&state.space], &be.output, 1.0) else { return };
    let at = state.seat.get_pointer().map(|p| p.current_location()).unwrap_or_default();
    let mut elements: Vec<Elem> = Vec::with_capacity(space.len() + 1);
    // front to back: the pointer is on top
    if let Ok(c) = MemoryRenderBufferRenderElement::from_buffer(&mut be.renderer, (at.x, at.y), &be.cursor, None, None, None, Kind::Cursor) {
        elements.push(Elem::Cursor(c));
    }
    elements.extend(space.into_iter().map(Elem::Space));
    match be.compositor.render_frame(&mut be.renderer, &elements, [0.07, 0.07, 0.07, 1.0], FrameFlags::DEFAULT) {
        Ok(r) if !r.is_empty => {
            if be.compositor.queue_frame(()).is_ok() {
                be.queued = true;
            }
        }
        Ok(_) => {}
        Err(e) => eprintln!("brasos-comp: render: {e:?}"),
    }
    let out = be.output.clone();
    let now = state.start_time.elapsed();
    state.space.elements().for_each(|w| w.send_frame(&out, now, Some(Duration::ZERO), |_, _| Some(out.clone())));
    state.space.refresh();
    state.popups.cleanup();
    let _ = state.display_handle.flush_clients();
}

pub fn init(event_loop: &mut EventLoop<Smallvil>, state: &mut Smallvil) -> Result<(), Box<dyn std::error::Error>> {
    let (mut session, notifier) = LibSeatSession::new().map_err(|e| format!("no session (seat access): {e:?}"))?;
    let seat = session.seat();

    let path = primary_gpu(&seat)?
        .or_else(|| all_gpus(&seat).ok().and_then(|v| v.into_iter().next()))
        .ok_or("no GPU found")?;
    let fd = session
        .open(&path, OFlags::RDWR | OFlags::CLOEXEC | OFlags::NOCTTY | OFlags::NONBLOCK)
        .map_err(|e| format!("open {}: {e:?}", path.display()))?;
    let fd = DrmDeviceFd::new(DeviceFd::from(fd));
    let (mut drm, notifier_drm) = DrmDevice::new(fd.clone(), true)?;

    // the first connected connector with a mode, at its preferred mode, on the first CRTC its encoder can drive
    let res = drm.resource_handles()?;
    let conn = res
        .connectors()
        .iter()
        .filter_map(|h| drm.get_connector(*h, true).ok())
        .find(|c| c.state() == connector::State::Connected && !c.modes().is_empty())
        .ok_or("no connected display")?;
    let mode = *conn
        .modes()
        .iter()
        .find(|m| m.mode_type().contains(ModeTypeFlags::PREFERRED))
        .unwrap_or(&conn.modes()[0]);
    let crtc = conn
        .encoders()
        .iter()
        .filter_map(|e| drm.get_encoder(*e).ok())
        .find_map(|e| res.filter_crtcs(e.possible_crtcs()).first().copied())
        .ok_or("no CRTC for the display")?;
    let surface = drm.create_surface(crtc, mode, &[conn.handle()])?;

    let wl_mode = WlMode::from(mode);
    let (pw, ph) = conn.size().unwrap_or((0, 0));
    let output = Output::new(
        format!("{}-{}", conn.interface().as_str(), conn.interface_id()),
        PhysicalProperties { size: (pw as i32, ph as i32).into(), subpixel: Subpixel::Unknown, make: "BrasOS".into(), model: "DRM".into(), serial_number: "Unknown".into() },
    );
    let _global = output.create_global::<Smallvil>(&state.display_handle);
    output.change_current_state(Some(wl_mode), None, None, Some((0, 0).into()));
    output.set_preferred(wl_mode);
    state.space.map_output(&output, (0, 0));

    let renderer = PixmanRenderer::new()?;
    let formats = [Fourcc::Xrgb8888, Fourcc::Argb8888];
    let compositor: Comp = DrmCompositor::new(
        &output,
        surface,
        None,
        DumbAllocator::new(fd.clone()),
        fd.clone(),
        formats,
        renderer.dmabuf_formats().iter().copied(),
        drm.cursor_size(),
        None::<GbmDevice<DrmDeviceFd>>,
    )?;

    let be: Shared = Rc::new(RefCell::new(Backend { drm, compositor, renderer, output, cursor: arrow(), queued: false }));
    let handle = event_loop.handle();

    // a frame reached the screen: free its buffer and draw the next
    let b = be.clone();
    handle.insert_source(notifier_drm, move |event, _, state| match event {
        DrmEvent::VBlank(_) => {
            let mut be = b.borrow_mut();
            let _ = be.compositor.frame_submitted();
            be.queued = false;
            render(&mut be, state);
        }
        DrmEvent::Error(e) => eprintln!("brasos-comp: drm: {e:?}"),
    })?;

    // an idle screen produces no vblank: look for new damage a few times a second
    let b = be.clone();
    handle.insert_source(Timer::from_duration(Duration::from_millis(16)), move |_, _, state| {
        render(&mut b.borrow_mut(), state);
        TimeoutAction::ToDuration(Duration::from_millis(16))
    })?;

    // keyboard and pointer
    let mut li = Libinput::new_with_udev::<LibinputSessionInterface<LibSeatSession>>(session.clone().into());
    li.udev_assign_seat(&seat).map_err(|_| "libinput could not take the seat")?;
    handle.insert_source(LibinputInputBackend::new(li.clone()), |event, _, state| state.process_input_event(event))?;

    // switching away (another VT) pauses the display and input; coming back resumes them
    let b = be.clone();
    handle.insert_source(notifier, move |event, _, state| match event {
        SessionEvent::PauseSession => {
            li.suspend();
            b.borrow_mut().drm.pause();
        }
        SessionEvent::ActivateSession => {
            let _ = li.resume();
            let mut be = b.borrow_mut();
            let _ = be.drm.activate(false);
            be.queued = false;
            be.compositor.reset_buffers();
            render(&mut be, state);
        }
    })?;

    // keep the session (and with it the DRM fd's seat access) alive for the life of the loop
    std::mem::forget(session);
    render(&mut be.borrow_mut(), state);
    Ok(())
}
