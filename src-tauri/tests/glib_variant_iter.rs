#![cfg(target_os = "linux")]

use glib::{variant::ToVariant, Variant};

fn string_array(values: &[&str]) -> Variant {
    Variant::array_from_iter::<String>(values.iter().map(|value| value.to_variant()))
}

// Swiph3l: RUSTSEC-2024-0429 can disappear in debug builds and crash with
// optimization. Run these first-party tests in both debug and release on Linux;
// the vendored upstream source stays unchanged apart from its two-line fix.
#[test]
fn string_iterator_preserves_unicode_and_mixed_end_traversal() {
    let values = ["", "front", "Zażółć", "日本語", "🦀", "Olá", "back", ""];
    let variant = string_array(&values);
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
    assert_eq!(
        variant.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        values.iter().rev().copied().collect::<Vec<_>>()
    );

    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.len(), 8);
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next_back(), Some(""));
    assert_eq!(iter.len(), 6);
    assert_eq!(iter.nth(1), Some("Zażółć"));
    assert_eq!(iter.nth_back(1), Some("Olá"));
    assert_eq!(iter.len(), 2);
    assert_eq!(iter.last(), Some("🦀"));
}

#[test]
fn empty_string_array_is_exhausted_from_both_ends() {
    let variant = string_array(&[]);
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.size_hint(), (0, Some(0)));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.nth(0), None);
    assert_eq!(iter.nth_back(0), None);
    assert_eq!(iter.last(), None);
}

#[test]
fn large_skips_and_meeting_ends_preserve_iterator_bounds() {
    let variant = string_array(&["", "a", "ž", "🦀"]);
    let mut forward = variant.array_iter_str().unwrap();
    assert_eq!(forward.nth(usize::MAX), None);
    assert_eq!(forward.len(), 0);
    assert_eq!(forward.next(), None);
    assert_eq!(forward.next_back(), None);

    let mut backward = variant.array_iter_str().unwrap();
    assert_eq!(backward.nth_back(usize::MAX), None);
    assert_eq!(backward.len(), 0);
    assert_eq!(backward.next_back(), None);
    assert_eq!(backward.next(), None);

    let mut mixed = variant.array_iter_str().unwrap();
    assert_eq!(mixed.nth(2), Some("ž"));
    assert_eq!(mixed.next_back(), Some("🦀"));
    assert_eq!(mixed.len(), 0);
    assert_eq!(mixed.next(), None);
    assert_eq!(mixed.next_back(), None);

    let mut reverse_mixed = variant.array_iter_str().unwrap();
    assert_eq!(reverse_mixed.nth_back(2), Some("a"));
    assert_eq!(reverse_mixed.next(), Some(""));
    assert_eq!(reverse_mixed.next_back(), None);
}
