// No display and no rendering: a virtual output so window management (placement, focus, the control socket) can be exercised
// without a GPU, in tests (`BRASOS_BACKEND=headless`). Nothing is drawn.
use smithay::{
    output::{Mode, Output, PhysicalProperties, Subpixel},
    utils::Transform,
};

use crate::Smallvil;

pub fn init(state: &mut Smallvil) {
    let mode = Mode { size: (1280, 800).into(), refresh: 60_000 };
    let output = Output::new("headless".into(), PhysicalProperties { size: (0, 0).into(), subpixel: Subpixel::Unknown, make: "BrasOS".into(), model: "Headless".into(), serial_number: "none".into() });
    let _ = output.create_global::<Smallvil>(&state.display_handle);
    output.change_current_state(Some(mode), Some(Transform::Normal), None, Some((0, 0).into()));
    output.set_preferred(mode);
    state.space.map_output(&output, (0, 0));
}
