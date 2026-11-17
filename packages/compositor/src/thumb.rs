// A small picture of a native window for the shell's window switcher (Alt+Tab). The compositor owns the window's pixels (the shell can't
// see them), so on request it reads the window's last shared-memory buffer, shrinks it with a box filter and sends the raw RGB bytes,
// base64 encoded, over the control socket; the shell draws them on a canvas. Pure functions, so they are tested without a display.
// Windows that draw with the GPU (dmabuf) are not readable this way: the caller answers "not readable" and the shell shows an icon.

/// where the bytes are and how they are laid out (a Wayland shm buffer)
pub struct Src<'a> {
    pub bytes: &'a [u8],
    pub offset: usize,
    pub w: usize,
    pub h: usize,
    pub stride: usize,
    /// bytes in memory are R,G,B,A (Abgr8888/Xbgr8888) instead of B,G,R,A (Argb8888/Xrgb8888)
    pub rgba_order: bool,
    /// the fourth byte is a (premultiplied) alpha, not padding
    pub alpha: bool,
}

/// what shows through a transparent window (the shell's dark background)
const BACKDROP: u32 = 18;

/// The biggest picture this makes: a window's whole picture is read once, so this bounds the cost and the reply (224 x 140 x 3 = 94 KB).
pub const MAX_W: usize = 224;
pub const MAX_H: usize = 140;

/// Shrinks the buffer to fit `max_w` x `max_h` (keeping its shape, never enlarging) and returns width, height and RGB bytes.
/// `None` for a buffer that is empty, absurdly large, or whose stride and size don't fit inside the bytes given.
pub fn downscale(s: &Src, max_w: usize, max_h: usize) -> Option<(usize, usize, Vec<u8>)> {
    if s.w == 0 || s.h == 0 || s.w > 16384 || s.h > 16384 || s.stride < s.w.checked_mul(4)? || max_w == 0 || max_h == 0 {
        return None;
    }
    let end = s.offset.checked_add((s.h - 1).checked_mul(s.stride)?)?.checked_add(s.w * 4)?;
    if end > s.bytes.len() {
        return None;
    }
    // the largest size inside the box that keeps the shape; at least one pixel each way
    let scale = (max_w as f64 / s.w as f64).min(max_h as f64 / s.h as f64).min(1.0);
    let tw = ((s.w as f64 * scale).round() as usize).clamp(1, max_w);
    let th = ((s.h as f64 * scale).round() as usize).clamp(1, max_h);
    let mut out = Vec::with_capacity(tw * th * 3);
    for ty in 0..th {
        let (y0, y1) = (ty * s.h / th, ((ty + 1) * s.h / th).max(ty * s.h / th + 1));
        for tx in 0..tw {
            let (x0, x1) = (tx * s.w / tw, ((tx + 1) * s.w / tw).max(tx * s.w / tw + 1));
            let (mut r, mut g, mut b, mut n) = (0u32, 0u32, 0u32, 0u32);
            for y in y0..y1.min(s.h) {
                let row = s.offset + y * s.stride;
                for x in x0..x1.min(s.w) {
                    let p = &s.bytes[row + x * 4..row + x * 4 + 4];
                    let (pr, pg, pb) = if s.rgba_order { (p[0] as u32, p[1] as u32, p[2] as u32) } else { (p[2] as u32, p[1] as u32, p[0] as u32) };
                    if s.alpha {
                        // premultiplied: what is behind shows through in proportion to the missing alpha
                        let back = BACKDROP * (255 - p[3] as u32) / 255;
                        r += pr + back;
                        g += pg + back;
                        b += pb + back;
                    } else {
                        r += pr;
                        g += pg;
                        b += pb;
                    }
                    n += 1;
                }
            }
            let n = n.max(1);
            out.extend_from_slice(&[(r / n).min(255) as u8, (g / n).min(255) as u8, (b / n).min(255) as u8]);
        }
    }
    Some((tw, th, out))
}

/// standard base64 with padding (the reply is one JSON line, so the bytes can't go raw)
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        o.push(T[(n >> 18) as usize & 63] as char);
        o.push(T[(n >> 12) as usize & 63] as char);
        o.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        o.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(bytes: &[u8], w: usize, h: usize, stride: usize) -> Src<'_> {
        Src { bytes, offset: 0, w, h, stride, rgba_order: false, alpha: false }
    }

    #[test]
    fn base64_matches_the_standard_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn a_picture_is_shrunk_by_averaging_and_never_enlarged() {
        // 4 x 2, B,G,R,X: the left half is pure red, the right half pure blue
        let mut px = vec![];
        for _ in 0..2 {
            for x in 0..4 {
                px.extend_from_slice(if x < 2 { &[0, 0, 255, 0] } else { &[255, 0, 0, 0] });
            }
        }
        let (w, h, rgb) = downscale(&src(&px, 4, 2, 16), 2, 1).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(rgb, [255, 0, 0, 0, 0, 255]);
        let (w, h, _) = downscale(&src(&px, 4, 2, 16), 100, 100).unwrap();
        assert_eq!((w, h), (4, 2)); // already small: kept
    }

    #[test]
    fn the_shape_is_kept_inside_the_box() {
        let px = vec![0u8; 1920 * 1080 * 4];
        let (w, h, rgb) = downscale(&src(&px, 1920, 1080, 1920 * 4), MAX_W, MAX_H).unwrap();
        assert!(w <= MAX_W && h <= MAX_H);
        assert!((w as f64 / h as f64 - 1920.0 / 1080.0).abs() < 0.1);
        assert_eq!(rgb.len(), w * h * 3);
    }

    #[test]
    fn channel_order_and_transparency() {
        let red_bgra = [0u8, 0, 255, 255];
        assert_eq!(downscale(&src(&red_bgra, 1, 1, 4), 1, 1).unwrap().2, [255, 0, 0]);
        let red_rgba = Src { rgba_order: true, ..src(&[255, 0, 0, 255], 1, 1, 4) };
        assert_eq!(downscale(&red_rgba, 1, 1).unwrap().2, [255, 0, 0]);
        // fully transparent premultiplied pixel: the backdrop shows
        let clear = Src { alpha: true, ..src(&[0, 0, 0, 0], 1, 1, 4) };
        assert_eq!(downscale(&clear, 1, 1).unwrap().2, [BACKDROP as u8; 3]);
    }

    #[test]
    fn a_buffer_that_does_not_fit_its_bytes_is_refused() {
        assert!(downscale(&src(&[0; 15], 2, 2, 8), 10, 10).is_none()); // needs 16
        assert!(downscale(&src(&[0; 64], 2, 2, 4), 10, 10).is_none()); // stride shorter than a row
        assert!(downscale(&src(&[0; 64], 0, 2, 8), 10, 10).is_none());
        assert!(downscale(&src(&[0; 64], 20000, 1, 80000), 10, 10).is_none());
        let off = Src { offset: usize::MAX - 2, ..src(&[0; 64], 2, 2, 8) };
        assert!(downscale(&off, 10, 10).is_none()); // no overflow
    }
}
