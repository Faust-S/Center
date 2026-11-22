//! Narrow native OS port for the official U04 Presentation Bridge.
//! Only an existing, bounded Obsidian installation may be observed or focused.
//! No launching, installation, general-purpose PID/HWND controls or storage.
use serde_json::{json,Value};

pub const APP_REF: &str = "external:obsidian";

#[cfg(windows)]
mod os {
    use super::*;
    use std::{env,path::{Path,PathBuf},mem::zeroed};

    #[repr(C)]
    #[derive(Copy,Clone)]
    struct FileTime {low:u32, high:u32}

    #[link(name="kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access:u32, inherit:i32, pid:u32)->isize;
        fn GetProcessTimes(handle:isize, created:*mut FileTime,
            exited:*mut FileTime,kernel:*mut FileTime,user:*mut FileTime)->i32;
        fn QueryFullProcessImageNameW(handle:isize,flags:u32,name:*mut u16,len:*mut u32)->i32;
        fn CloseHandle(handle:isize)->i32;
    }
    #[link(name="user32")]
    unsafe extern "system" {
        fn EnumWindows(callback:Option<unsafe extern "system" fn(isize,isize)->i32>,data:isize)->i32;
        fn GetWindowThreadProcessId(hwnd:isize,pid:*mut u32)->u32;
        fn IsWindowVisible(hwnd:isize)->i32;
        fn GetWindowTextLengthW(hwnd:isize)->i32;
        fn SetForegroundWindow(hwnd:isize)->i32;
        fn GetForegroundWindow()->isize;
    }

    #[derive(Copy,Clone)]
    struct Window {pid:u32, hwnd:isize}
    unsafe extern "system" fn enum_candidate(hwnd:isize,data:isize)->i32 {
        let rows=&mut *(data as *mut Vec<Window>);
        if rows.len()>=1024 {return 0;}
        if IsWindowVisible(hwnd)==0||GetWindowTextLengthW(hwnd)<=0{return 1;}
        let mut pid=0u32;
        GetWindowThreadProcessId(hwnd,&mut pid);
        if pid>0{rows.push(Window{pid,hwnd});}
        1
    }
    fn windows()->Vec<Window>{
        let mut rows=Vec::new();
        unsafe{EnumWindows(Some(enum_candidate),(&mut rows as *mut Vec<Window>) as isize);}
        rows
    }
    fn observed_process(pid:u32)->Option<(u64,PathBuf)>{
        if pid==0{return None;}
        unsafe{
            let handle=OpenProcess(0x1000,0,pid);
            if handle==0{return None;}
            let outcome=(||{
                let mut created:FileTime=zeroed();
                let mut exited:FileTime=zeroed();
                let mut kernel:FileTime=zeroed();
                let mut user:FileTime=zeroed();
                if GetProcessTimes(handle,&mut created,&mut exited,&mut kernel,&mut user)==0{
                    return None;
                }
                let mut buf=vec![0u16;32768];
                let mut length=buf.len() as u32;
                if QueryFullProcessImageNameW(handle,0,buf.as_mut_ptr(),&mut length)==0
                    ||length==0||length as usize>buf.len(){return None;}
                let name=String::from_utf16(&buf[..length as usize]).ok()?;
                Some(((u64::from(created.high)<<32)|u64::from(created.low),PathBuf::from(name)))
            })();
            CloseHandle(handle);
            outcome
        }
    }
    fn approved_candidates()->Vec<PathBuf>{
        let mut out=Vec::new();
        if let Some(local)=env::var_os("LOCALAPPDATA"){
            let root=PathBuf::from(local);
            out.push(root.join("Programs").join("Obsidian").join("Obsidian.exe"));
            out.push(root.join("Programs").join("obsidian").join("Obsidian.exe"));
            out.push(root.join("Obsidian").join("Obsidian.exe"));
        }
        for key in ["PROGRAMFILES","PROGRAMFILES(X86)"]{
            if let Some(base)=env::var_os(key){
                out.push(PathBuf::from(base).join("Obsidian").join("Obsidian.exe"));
            }
        }
        out
    }
    fn approved(image:&Path)->bool{
        let Some(canonical)=image.canonicalize().ok() else{return false;};
        if canonical.file_name().and_then(|n|n.to_str()).is_none_or(|n|!n.eq_ignore_ascii_case("Obsidian.exe")){
            return false;
        }
        let actual=canonical.to_string_lossy();
        approved_candidates().iter().filter_map(|candidate|candidate.canonicalize().ok())
            .any(|candidate|candidate.to_string_lossy().eq_ignore_ascii_case(&actual))
    }
    fn identity(pid:u32,stamp:&str)->bool{
        let Ok(stamp)=stamp.parse::<u64>() else{return false;};
        observed_process(pid).is_some_and(|(created,path)|created==stamp&&approved(&path))
    }
    fn window_for(pid:u32)->Option<isize>{
        windows().into_iter().find(|row|row.pid==pid).map(|row|row.hwnd)
    }

    pub fn find(app_ref:&str)->Value{
        if app_ref!=APP_REF{return json!({"status":"PROGRAM_UNSUPPORTED"});}
        for row in windows(){
            if let Some((stamp,image))=observed_process(row.pid){
                if approved(&image){return json!({"status":"WINDOW_OBSERVED",
                    "pid":row.pid,"processStamp":stamp.to_string(),
                    "windowRef":row.hwnd.to_string()});}
            }
        }
        json!({"status":"WINDOW_NOT_FOUND"})
    }
    pub fn verify(app_ref:&str,pid:u32,stamp:&str)->Value{
        json!({"verified":app_ref==APP_REF&&identity(pid,stamp)})
    }
    pub fn observe(app_ref:&str,pid:u32,stamp:&str)->Value{
        if app_ref!=APP_REF||!identity(pid,stamp){return json!({"observed":false});}
        match window_for(pid){
            Some(hwnd)=>json!({"observed":true,"windowRef":hwnd.to_string()}),
            None=>json!({"observed":false})
        }
    }
    pub fn focus(app_ref:&str,pid:u32,stamp:&str,window_ref:&str)->Value{
        if app_ref!=APP_REF||!identity(pid,stamp){return json!({"focused":false});}
        let Ok(selected)=window_ref.parse::<isize>() else{return json!({"focused":false});};
        if selected<=0||window_for(pid)!=Some(selected){return json!({"focused":false});}
        let focused=unsafe{
            SetForegroundWindow(selected);
            GetForegroundWindow()==selected
        };
        json!({"focused":focused})
    }
}

#[cfg(not(windows))]
mod os {
    use super::*;
    pub fn find(_: &str)->Value{json!({"status":"PLATFORM_UNSUPPORTED"})}
    pub fn verify(_: &str,_:u32,_:&str)->Value{json!({"verified":false})}
    pub fn observe(_: &str,_:u32,_:&str)->Value{json!({"observed":false})}
    pub fn focus(_: &str,_:u32,_:&str,_:&str)->Value{json!({"focused":false})}
}

pub use os::{find,verify,observe,focus};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_app_never_qualifies_as_native_window(){
        assert_ne!(find("external:anything")["status"],"WINDOW_OBSERVED");
        assert_eq!(verify("external:anything",1,"123")["verified"],false);
        assert_eq!(focus("external:anything",1,"123","100")["focused"],false);
    }
}
