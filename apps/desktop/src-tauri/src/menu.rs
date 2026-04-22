//! macOS application menu.
//!
//! Standard macOS menu set so keyboard users get expected behavior: Cmd+Q,
//! Cmd+W, Cmd+M, plus Edit menu accelerators required for Cmd+C/V/X to work
//! inside text fields.
//!
//! Explicitly omitted: Cmd+R (reserved for future frontend refresh action),
//! Cmd+K (reserved for the in-app quick switcher).

use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

pub const MENU_ID_NEW_PROJECT: &str = "designer.new_project";
pub const MENU_ID_FEEDBACK: &str = "designer.feedback";

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Designer"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .short_version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Designer")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Designer"),
            Some(about_metadata),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // HIG: ellipsis because the command prompts for input before creating.
    let new_project = MenuItemBuilder::new("New Project…")
        .id(MENU_ID_NEW_PROJECT)
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // View menu contains dev-only entries so Cmd+R stays free for the frontend.
    #[cfg(debug_assertions)]
    let view_menu = {
        let toggle_devtools = MenuItemBuilder::new("Toggle Developer Tools")
            .id("designer.devtools")
            .accelerator("CmdOrCtrl+Alt+I")
            .build(app)?;
        SubmenuBuilder::new(app, "View").item(&toggle_devtools).build()?
    };

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    let feedback = MenuItemBuilder::new("Report Feedback…")
        .id(MENU_ID_FEEDBACK)
        .build(app)?;

    let help_menu = SubmenuBuilder::new(app, "Help").item(&feedback).build()?;

    let builder = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu);
    #[cfg(debug_assertions)]
    let builder = builder.item(&view_menu);
    let menu = builder.item(&window_menu).item(&help_menu).build()?;

    Ok(menu)
}
