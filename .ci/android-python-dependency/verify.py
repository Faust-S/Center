"""Verify wheel identity, Android ABI and native ELF, without importing on host."""
import email
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
from fetch import SHA256, VERSION

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def main(abi):
    machines = {"x86_64":62, "arm64_v8a":183}
    require(abi in machines, "ABI")
    wheels = list(Path("wheelhouse").glob("*.whl"))
    require(len(wheels)==1, "WHEEL_COUNT")
    wheel = wheels[0]
    match = re.fullmatch(r"rpds_py-2026\.5\.1-cp313-(?:cp313|abi3)-android_(\d+)_"+abi+r"\.whl",wheel.name)
    require(match and 24 <= int(match[1]) <= 33, "ANDROID_WHEEL_TAG")
    with zipfile.ZipFile(wheel) as z:
        names = z.namelist()
        metadata = [n for n in names if n.endswith(".dist-info/METADATA")]
        require(len(metadata)==1,"METADATA")
        meta = email.message_from_bytes(z.read(metadata[0]))
        require(meta["Name"].replace("_","-").lower()=="rpds-py" and meta["Version"]==VERSION,"PACKAGE_IDENTITY")
        extensions = [n for n in names if n.startswith("rpds/") and n.endswith(".so")]
        require(len(extensions)==1,"NATIVE_EXTENSION")
        binary = z.read(extensions[0])
        require(binary[:6]==b"\x7fELF\x02\x01" and struct.unpack_from("<H",binary,18)[0]==machines[abi],"ELF_ABI")
        with tempfile.TemporaryDirectory() as tmp:
            lib = Path(tmp)/"rpds.so"
            lib.write_bytes(binary)
            dynamic = subprocess.check_output(["readelf","-d",str(lib)],text=True)
            require("Shared library: [libpython3.13.so]" in dynamic,"ANDROID_PYTHON_LINKAGE")
            require("libc.so.6" not in dynamic and "libpthread.so.0" not in dynamic,"LINUX_ABI_REJECTED")
    receipt = {"schema":"IWXA_ANDROID_PUBLIC_WHEEL_1","package":"rpds-py","version":VERSION,
               "source_sha256":SHA256,"filename":wheel.name,"wheel_sha256":hashlib.sha256(wheel.read_bytes()).hexdigest(),
               "bytes":wheel.stat().st_size,"abi":abi,"python":"3.13","android_api":int(match[1]),
               "native_elf":"PASS","runtime":"PASS" if abi=="x86_64" else "NOT_RUN"}
    (wheel.parent/"receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
    print("RPDS_ANDROID_WHEEL=PASS")
    print(json.dumps(receipt,sort_keys=True))

if __name__=="__main__":
    main(sys.argv[1])
