# Known Issues

## ~~Tauri desktop builds fail with Rust 1.96 (E0119)~~ — RESOLVED

**Was:** `time 0.3.48` introduced a `From<HourBase>` impl that conflicts with `cookie 0.18.1`'s
blanket `impl<T: Into<Option<OffsetDateTime>>> From<T> for Expiration` under Rust's coherence rules.
Affected `tauri-utils 2.9.2` and everything that depends on it.

**Fix applied:**
- `cargo update time --precise 0.3.47` in both `packages/viewer/src-tauri` and
  `packages/broadcaster/src-tauri` — pins the lock file to `time 0.3.47` which doesn't have the
  conflicting impl.
- The lock files are committed so the pin is stable. Remove it once `cookie` or `tauri-utils`
  publishes a fix (tracked: tauri-apps/tauri#15525, time-rs/time#783).

**References:** tauri-apps/tauri#15525, time-rs/time#783
