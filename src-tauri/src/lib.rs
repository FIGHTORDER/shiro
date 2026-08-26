use tauri::Manager;

mod ais;
mod archives;
mod content;
mod engine;
mod engine_settings;
mod game_files;
mod install;
mod launch;
mod loadscreen;
mod managed;
mod mapview;
mod relay;
mod sidecar;
mod skins;
mod apps;
mod zkcontent;
mod zkweb;

pub fn run() {
    tauri::Builder::default()
        /* Single instance first, and it has to be first: the plugin works by
           refusing to start a second process, and anything registered before it
           would run in a process that is about to exit.

           Zero-K's links are `zk://` and the Zero-K client claims that scheme
           too, so a machine with both hands them to whichever installed last.
           That is understood and accepted - see docs/UPDATES.md's neighbours in
           spirit: we behave like the client we are replacing.

           Without this, following a link while Shiro is already open would
           start a second Shiro, which would fail to bind the relay and leave
           two windows arguing about one account. */
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            /* The link itself needs nothing here. With the `deep-link` feature
               on, this plugin hands the second process's command line to the
               deep-link plugin before this callback runs, and that is what
               fires `onOpenUrl` in the window that already exists. Reading argv
               here as well would deliver every link twice.

               What is left is the part no plugin does: somebody who followed a
               link expects a window, so raise the one there is. */
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        /* Bundled apps are put in place before the window opens, so the
           launcher's first paint is already the truth. A failure here is not
           worth refusing to start the lobby over - the app simply shows as not
           installed, which is what it is. */
        .setup(|app| {
            /* Before anything detects an install. Detection is otherwise blind
               to the directory Shiro fills itself, and knew about it only
               through a setting the browser can lose. */
            if let Ok(dir) = managed::root(app.handle()) {
                install::set_managed_root(dir);
            }
            managed::seed_loadscreen(app.handle());
            if let Err(e) = apps::seed_bundled(app.handle()) {
                eprintln!("could not place the bundled apps: {e}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .manage(relay::Relay::default())
        .manage(launch::Game::default())
        .manage(content::Content::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            relay::zks_connect,
            relay::zks_send,
            relay::zks_disconnect,
            relay::zks_password_hash,
            launch::zks_locate_install,
            launch::zks_launch_spring,
            launch::zks_launch_preview,
            engine_settings::zks_read_engine_settings,
            engine_settings::zks_write_engine_settings,
            game_files::zks_read_infolog,
            game_files::zks_read_lups,
            game_files::zks_write_lups,
            game_files::zks_write_cmdcolors,
            content::zks_content_fetch,
            content::zks_content_cancel,
            content::zks_content_preflight,
            content::zks_content_log,
            ais::zks_list_ais,
            zkcontent::zks_find_maps,
            zkcontent::zks_game_modes,
            zkcontent::zks_map_catalogue,
            mapview::zks_map_terrain,
            managed::zks_managed_root,
            managed::zks_managed_state,
            managed::zks_managed_prepare,
            managed::zks_managed_install_engine,
            managed::zks_managed_remove,
            managed::zks_loadscreen_state,
            managed::zks_loadscreen_set,
            skins::zks_skin_catalogue,
            skins::zks_skin_status,
            skins::zks_skin_install,
            skins::zks_skin_remove,
            skins::zks_skin_load,
            apps::zka_catalogue,
            apps::zka_status,
            apps::zka_install,
            apps::zka_launch,
            apps::zka_uninstall,
            zkweb::zkw_profile,
            zkweb::zkw_ratings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
