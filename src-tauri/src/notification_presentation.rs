//! Toast text and provider/color artwork. Message content is never written to disk.
use crate::{
    providers::{NotificationColor, ProviderId, ServiceConfig},
    state::{Language, NotificationPreview},
};

pub struct Presentation {
    pub title: String,
    pub body: String,
    pub attribution: String,
}

fn excerpt(value: &str, limit: usize) -> String {
    // Native XML rejects these characters. The toast backend escapes <, >, &, quotes.
    let clean = value
        .chars()
        .filter(|character| {
            (!character.is_control() || character.is_whitespace())
                && !matches!(*character, '\u{fffe}' | '\u{ffff}')
        })
        .collect::<String>();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = clean.chars();
    let clipped = characters.by_ref().take(limit).collect::<String>();
    if characters.next().is_some() {
        format!(
            "{}…",
            clipped
                .chars()
                .take(limit.saturating_sub(1))
                .collect::<String>()
        )
    } else {
        clipped
    }
}

fn provider_name(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::SynologyChatplus => "Synology ChatPlus",
        ProviderId::SynologyChat => "Synology Chat",
        ProviderId::Discord => "Discord",
        ProviderId::Slack => "Slack",
        ProviderId::Mattermost => "Mattermost",
    }
}

pub fn prepare(
    service: Option<&ServiceConfig>,
    mode: &NotificationPreview,
    title: &str,
    body: &str,
    language: &Language,
) -> Presentation {
    let (title, body) = crate::desktop_notifications::preview(mode, title, body, language);
    let attribution = service.map_or_else(
        || "ChatPlus Desktop".into(),
        |service| {
            let provider = provider_name(service.provider);
            if matches!(mode, NotificationPreview::Generic) {
                return provider.into();
            }
            let name = excerpt(&service.name, 60);
            if name.is_empty() || name == provider {
                provider.into()
            } else {
                format!("{name} · {provider}")
            }
        },
    );
    let title = excerpt(&title, 160);
    let body = excerpt(&body, 240);
    Presentation {
        title: if title.is_empty() {
            "ChatPlus Desktop".into()
        } else {
            title
        },
        body: if body.is_empty() {
            crate::i18n::text(language, "notification.newMessage")
        } else {
            body
        },
        attribution,
    }
}

#[cfg(any(windows, test))]
fn color_rgb(color: &NotificationColor, accent: [u8; 3]) -> [u8; 3] {
    match color {
        NotificationColor::Auto => accent,
        NotificationColor::Blue => [37, 99, 197],
        NotificationColor::Cyan => [24, 169, 189],
        NotificationColor::Green => [46, 169, 108],
        NotificationColor::Amber => [230, 178, 63],
        NotificationColor::Orange => [230, 138, 63],
        NotificationColor::Red => [199, 57, 72],
        NotificationColor::Purple => [131, 84, 198],
        NotificationColor::Magenta => [183, 54, 140],
        NotificationColor::Custom(value) => {
            if value.len() != 7
                || !value.starts_with('#')
                || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return accent;
            }
            std::array::from_fn(|index| {
                u8::from_str_radix(&value[index * 2 + 1..index * 2 + 3], 16)
                    .unwrap_or(accent[index])
            })
        }
    }
}

#[cfg(any(windows, test))]
fn provider_art(provider: ProviderId) -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(match provider {
        ProviderId::SynologyChatplus => {
            include_bytes!("../../public/providers/synology-chatplus.png")
        }
        ProviderId::SynologyChat => include_bytes!("../../public/providers/synology-chat.png"),
        ProviderId::Discord => include_bytes!("../icons/providers/discord.png"),
        _ => include_bytes!("../icons/128x128.png"),
    })
}

#[cfg(any(windows, test))]
fn icon_rgba(source: &tauri::image::Image<'_>, color: [u8; 3]) -> Vec<u8> {
    const SIZE: u32 = 128;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    // A rounded tile carries the chosen service color; a neutral inset keeps
    // the provider artwork readable even when the user selects black or white.
    for y in 0..SIZE {
        for x in 0..SIZE {
            let corner_x = x.clamp(20, 107) as f32;
            let corner_y = y.clamp(20, 107) as f32;
            if (x as f32 - corner_x).powi(2) + (y as f32 - corner_y).powi(2) <= 20_f32.powi(2) {
                rgba[((y * SIZE + x) * 4) as usize..((y * SIZE + x) * 4 + 4) as usize]
                    .copy_from_slice(&[color[0], color[1], color[2], 255]);
            }
        }
    }
    let scale = 88.0 / source.width().max(source.height()) as f32;
    let width = (source.width() as f32 * scale).round().max(1.) as u32;
    let height = (source.height() as f32 * scale).round().max(1.) as u32;
    let left = (SIZE - width) / 2;
    let top = (SIZE - height) / 2;
    for y in 14..114 {
        for x in 14..114 {
            let corner_x = x.clamp(28, 99) as f32;
            let corner_y = y.clamp(28, 99) as f32;
            if (x as f32 - corner_x).powi(2) + (y as f32 - corner_y).powi(2) <= 14_f32.powi(2) {
                rgba[((y * SIZE + x) * 4) as usize..((y * SIZE + x) * 4 + 4) as usize]
                    .copy_from_slice(&[248, 250, 252, 255]);
            }
        }
    }
    for y in 0..height {
        for x in 0..width {
            let sx = x * source.width() / width;
            let sy = y * source.height() / height;
            let source_index = ((sy * source.width() + sx) * 4) as usize;
            let target_index = (((top + y) * SIZE + left + x) * 4) as usize;
            let alpha = source.rgba()[source_index + 3] as u32;
            for channel in 0..3 {
                rgba[target_index + channel] = ((source.rgba()[source_index + channel] as u32
                    * alpha
                    + rgba[target_index + channel] as u32 * (255 - alpha))
                    / 255) as u8;
            }
        }
    }
    rgba
}

#[cfg(any(windows, test))]
fn png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    fn chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        output.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = output.len();
        output.extend_from_slice(kind);
        output.extend_from_slice(data);
        let mut crc = !0_u32;
        for byte in &output[start..] {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & (0_u32.wrapping_sub(crc & 1)));
            }
        }
        output.extend_from_slice(&(!crc).to_be_bytes());
    }
    let mut filtered = Vec::with_capacity(rgba.len() + height as usize);
    for row in rgba.chunks_exact(width as usize * 4) {
        filtered.push(0); // PNG filter: none.
        filtered.extend_from_slice(row);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks = filtered.chunks(65535).collect::<Vec<_>>();
    for (index, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == blocks.len())); // Stored DEFLATE block, final bit.
        let length = block.len() as u16;
        zlib.extend_from_slice(&length.to_le_bytes());
        zlib.extend_from_slice(&(!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1_u32, 0_u32);
    for byte in filtered {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut output = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = width.to_be_bytes().to_vec();
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]); // 8-bit RGBA, no interlace.
    chunk(&mut output, b"IHDR", &header);
    chunk(&mut output, b"IDAT", &zlib);
    chunk(&mut output, b"IEND", &[]);
    output
}

#[cfg(windows)]
pub fn icon_path(
    app: &tauri::AppHandle,
    service: Option<&ServiceConfig>,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let settings = crate::state::current(app);
    let dark = match settings.theme {
        crate::state::Theme::Dark => true,
        crate::state::Theme::Light => false,
        crate::state::Theme::System => {
            app.get_window("main")
                .and_then(|window| window.theme().ok())
                == Some(tauri::Theme::Dark)
        }
    };
    let accent = if dark { [57, 126, 219] } else { [37, 99, 197] };
    let provider = service.map_or(ProviderId::SynologyChatplus, |service| service.provider);
    let color = service.map_or(accent, |service| {
        color_rgb(&service.notification_color, accent)
    });
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Icon cache unavailable")?
        .join("notification-icons");
    std::fs::create_dir_all(&directory).map_err(|_| "Icon cache unavailable")?;
    let path = directory.join(format!(
        "v1-{provider:?}-{:02x}{:02x}{:02x}.png",
        color[0], color[1], color[2]
    ));
    if !path.is_file() {
        let image = provider_art(provider).map_err(|_| "Provider icon unavailable")?;
        let data = png(&icon_rgba(&image, color), 128, 128);
        // Keep the cached file stable for Action Center; publish only a complete PNG.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let temporary = path.with_extension(format!(
            "{}.tmp",
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&temporary, data).map_err(|_| "Icon cache unavailable")?;
        if std::fs::rename(&temporary, &path).is_err() {
            let _ = std::fs::remove_file(&temporary);
            if !path.is_file() {
                return Err("Icon cache unavailable".into());
            }
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn service(name: &str) -> ServiceConfig {
        ServiceConfig {
            id: "discord-work".into(),
            provider: ProviderId::Discord,
            name: name.into(),
            url: "https://discord.com/app/".into(),
            enabled: true,
            notifications: true,
            notification_color: NotificationColor::Custom("#12abef".into()),
        }
    }
    #[test]
    fn presentation_identifies_service_preserves_sender_and_bounds_unicode_excerpt() {
        let body = format!("  hello\n\tworld {}", "🙂".repeat(500));
        let view = prepare(
            Some(&service("Work chat")),
            &NotificationPreview::Full,
            "Alice · #general",
            &body,
            &Language::En,
        );
        assert_eq!(view.title, "Alice · #general");
        assert_eq!(view.attribution, "Work chat · Discord");
        assert!(view.body.starts_with("hello world "));
        assert_eq!(view.body.chars().count(), 240);
        assert!(view.body.ends_with('…'));
        assert!(!view.body.contains('\n'));
    }
    #[test]
    fn private_preview_modes_never_expose_message_body_or_hidden_sender() {
        for mode in [NotificationPreview::Sender, NotificationPreview::Generic] {
            let view = prepare(
                Some(&service("Private workspace name")),
                &mode,
                "Private sender",
                "Secret body",
                &Language::En,
            );
            assert!(!view.body.contains("Secret"));
            if matches!(mode, NotificationPreview::Generic) {
                assert_eq!(view.title, "ChatPlus Desktop");
                assert_eq!(view.attribution, "Discord");
            } else {
                assert_eq!(view.title, "Private sender");
                assert_eq!(view.attribution, "Private workspace name · Discord");
            }
        }
    }
    #[test]
    fn text_rejects_invalid_xml_characters_without_mangling_literals_for_backend_escaping() {
        let literal = "Alice <&> \"'";
        let view = prepare(
            Some(&service("Work\u{0000}\u{ffff}<>&")),
            &NotificationPreview::Full,
            &format!("{literal}\u{fffe}"),
            "body\u{0000}\u{ffff}\u{0001}<>&",
            &Language::En,
        );
        assert_eq!(view.title, literal);
        assert_eq!(view.body, "body<>&");
        assert_eq!(view.attribution, "Work<>& · Discord");
        let empty = prepare(
            None,
            &NotificationPreview::Full,
            "\u{0000}\u{ffff}",
            "",
            &Language::Pl,
        );
        assert_eq!(empty.title, "ChatPlus Desktop");
        assert_eq!(
            empty.body,
            crate::i18n::text(&Language::Pl, "notification.newMessage")
        );
    }
    #[test]
    fn native_palette_matches_custom_and_legacy_notification_colors() {
        assert_eq!(
            color_rgb(&NotificationColor::Custom("#12ABef".into()), [1, 2, 3]),
            [18, 171, 239]
        );
        assert_eq!(
            color_rgb(&NotificationColor::Custom("#ffffff;bad".into()), [1, 2, 3]),
            [1, 2, 3]
        );
        assert_eq!(
            color_rgb(&NotificationColor::Auto, [57, 126, 219]),
            [57, 126, 219]
        );
        assert_eq!(color_rgb(&NotificationColor::Red, [1, 2, 3]), [199, 57, 72]);
    }
    #[test]
    fn colored_provider_png_round_trips_rgba_at_the_deflate_block_boundary() {
        for provider in [
            ProviderId::SynologyChatplus,
            ProviderId::SynologyChat,
            ProviderId::Discord,
        ] {
            let source = provider_art(provider).unwrap();
            let rgba = icon_rgba(&source, [18, 171, 239]);
            let encoded = png(&rgba, 128, 128);
            let decoded = tauri::image::Image::from_bytes(&encoded).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (128, 128));
            assert_eq!(decoded.rgba(), rgba);
            assert_eq!(
                &rgba[(4 * 128 + 64) * 4..(4 * 128 + 64) * 4 + 4],
                &[18, 171, 239, 255]
            );
            assert_eq!(&rgba[..4], &[0, 0, 0, 0]);
            assert_ne!(
                &rgba[(64 * 128 + 64) * 4..(64 * 128 + 64) * 4 + 3],
                &[18, 171, 239]
            );
        }
    }
}
