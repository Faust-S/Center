use std::{cell::Cell, fs::OpenOptions, io::Write, path::{Path, PathBuf}, rc::Rc};
use tao::{event::{Event, WindowEvent}, event_loop::{ControlFlow, EventLoop}, window::WindowBuilder};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows, Rect, dpi::{LogicalPosition, LogicalSize}};

fn log(path: &Path, line: &str) {
    let mut out = OpenOptions::new().create(true).append(true).open(path).unwrap();
    writeln!(out, "{line}").unwrap();
}
fn rect(x: i32, y: i32, w: u32, h: u32) -> Rect {
    Rect { position: LogicalPosition::new(x,y).into(), size: LogicalSize::new(w,h).into() }
}
fn main() -> wry::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 3);
    let url = &args[1];
    let dir = PathBuf::from(&args[2]);
    let trace = dir.join("native.log");
    let dest = dir.join("saved.txt");
    let armed = Rc::new(Cell::new(false));
    let loop_ = EventLoop::new();
    let window = WindowBuilder::new().with_title("Native download probe")
        .with_inner_size(tao::dpi::LogicalSize::new(760.0,480.0)).with_resizable(false)
        .build(&loop_).unwrap();
    let mut shell_context = WebContext::new(Some(dir.join("shell")));
    let mut guest_context = WebContext::new(Some(dir.join("guest")));
    let (grant, t) = (armed.clone(), trace.clone());
    let shell = WebViewBuilder::new_with_web_context(&mut shell_context)
        .with_additional_browser_args("--force-renderer-accessibility --no-first-run")
        .with_bounds(rect(0,0,760,100))
        .with_html(r#"<!doctype html><button id="arm" onclick="window.ipc.postMessage('arm')">Arm download</button>"#)
        .with_ipc_handler(move |req| { if req.body() == "arm" { grant.set(true); log(&t,"ARMED"); } })
        .build_as_child(&window)?;
    let (t_dom,t_nav,t_start,t_finish) = (trace.clone(),trace.clone(),trace.clone(),trace.clone());
    let (grant, expected) = (armed.clone(), dest.clone());
    let guest = WebViewBuilder::new_with_web_context(&mut guest_context)
        .with_additional_browser_args("--force-renderer-accessibility --no-first-run")
        .with_bounds(rect(0,100,760,380)).with_url(url)
        .with_ipc_handler(move |req| {
            if matches!(req.body().as_str(), "DOM 0 0"|"DOM 0 1"|"DOM 1 0"|"DOM 1 1"|"PICKER 0 0"|"PICKER 0 1"|"PICKER 1 0"|"PICKER 1 1"|"FILE_SELECTED"|"FILE_WRONG"|"UPLOAD_SUBMIT") { log(&t_dom,req.body()); }
        })
        .with_navigation_handler(move |url| { if url.ends_with("/download") { log(&t_nav,"NAVIGATION"); } true })
        .with_download_started_handler(move |_, path| {
            if grant.replace(false) { *path=dest.clone(); log(&t_start,"REQUEST_ALLOWED"); true }
            else { log(&t_start,"REQUEST_BLOCKED"); false }
        })
        .with_download_completed_handler(move |_, path, success| {
            let matching = path.as_ref().and_then(|p|p.canonicalize().ok()).zip(expected.canonicalize().ok()).is_some_and(|(a,b)|a==b);
            log(&t_finish, if success && matching {"FINISH_SAVED"} else if success {"FINISH_WRONG_PATH"} else {"FINISH_CANCELLED_OR_FAILED"});
        })
        .build_as_child(&window)?;
    log(&trace,"READY");
    loop_.run(move |event,_,control| {
        let _keep = (&window,&shell,&guest,&shell_context,&guest_context);
        *control=ControlFlow::Wait;
        if let Event::WindowEvent{event:WindowEvent::CloseRequested,..}=event{*control=ControlFlow::Exit;}
    });
}
