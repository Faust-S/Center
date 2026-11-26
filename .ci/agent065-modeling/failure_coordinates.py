"""Convert private runner paths to finite ordinals in the pinned inventory."""
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


def _normal(value):
    if value.startswith('file:///'):
        value=unquote(urlsplit(value).path)
        if re.match(r'^/[A-Za-z]:/',value):value=value[1:]
    value=value.replace(chr(92),'/')
    if value.startswith('//?/'):value=value[4:]
    value=re.sub(r'/+', '/', value)
    return value


def coordinate(path,line,column,source_root,inventory,*,cwd=''):
    if not isinstance(path,str) or not path or len(path)>32768:return None
    if any(type(v) not in (int,str) or not re.fullmatch(r'[0-9]{1,8}',str(v)) for v in (line,column)):return None
    line,column=int(line),int(column)
    if line>10_000_000 or column>10_000_000:return None
    text=_normal(path)
    root=_normal(str(source_root)).rstrip('/')+'/'
    windows=bool(re.match(r'^[A-Za-z]:/',root))
    match=(lambda value:value.casefold()) if windows else (lambda value:value)
    if match(text).startswith(match(root)):
        text=text[len(root):]
    elif text.startswith('/') or re.match(r'^[A-Za-z]:/',text):
        return None
    else:
        text=text.removeprefix('./')
        if cwd and not match(text).startswith(match(cwd.rstrip('/')+'/')):text=cwd.rstrip('/')+'/'+text
    if text in inventory:return f'{inventory[text]}:{line}:{column}'
    if windows:
        candidates=[v for k,v in inventory.items() if k.casefold()==text.casefold()]
        if len(candidates)==1:return f'{candidates[0]}:{line}:{column}'
    return None


def structured_locations(report,source_root,inventory,*,cwd=''):
    path=Path(report)
    if not path.is_file() or path.stat().st_size>4_000_000:return set()
    found=set()
    for line in path.read_text(encoding='utf-8',errors='replace').splitlines():
        try:
            row=json.loads(line)
            if type(row) is not dict or set(row)!={'file','line','column'}:continue
            value=coordinate(row['file'],row['line'],row['column'],source_root,inventory,cwd=cwd)
            if value:found.add(value)
        except (ValueError,TypeError):continue
    return found
