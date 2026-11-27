#!/usr/bin/env bash
# Original pinned AMD64 image. Public controlled map only. No protected code
# or secrets are passed to native Docker build/run containers.
set -euo pipefail
root="$1"
image='ghcr.io/valhalla/valhalla@sha256:d3fe5fac55a8a3146184a27a6c514a9504f9d8be71db919c15ccb9c96e51df5b'
mkdir -p "$root/bin" "$root/lib" "$root/graph"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends osmium-tool libcurl4 libczmq4 libluajit-5.1-2 libgeotiff5 libprotobuf-lite32 libsqlite3-0 libsqlite3-mod-spatialite libzmq5 zlib1g
docker pull "$image"
cid="$(docker create --network none "$image" true)"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
docker cp "$cid:/usr/local/bin/valhalla_service" "$root/bin/valhalla_service"
docker cp "$cid:/usr/local/lib/." "$root/lib/"
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
ldd "$root/bin/valhalla_service" > "$root/native-links.txt"
if grep -q 'not found' "$root/native-links.txt"; then cat "$root/native-links.txt"; exit 1; fi
"$root/bin/valhalla_service" --version | grep -F '3.8.2'
python3 -c 'import sys; from pathlib import Path; sys.path.insert(0,"qualification/professional-geospatial"); from topology_fixture import write; write(Path(sys.argv[1]))' "$root/graph/fixture.osm"
osmium cat "$root/graph/fixture.osm" -o "$root/graph/map.osm.pbf"
docker run --rm --network none --cpus 2 --user "$(id -u):$(id -g)" -e HOME=/tmp "$image" valhalla_build_config > "$root/graph/config.json"
python3 - "$root/graph/config.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);c=json.loads(p.read_text());m=c['mjolnir']
m.update(tile_dir='/data/tiles',tile_extract='',traffic_extract='',admin='',timezone='')
m.pop('tile_url',None)
m['data_processing']['use_admin_db']=False
m['data_processing']['apply_country_overrides']=False
c['httpd']['service']['listen']='tcp://127.0.0.1:8002'
c['additional_data'].pop('elevation_url',None)
c['additional_data']['elevation']=''
p.write_text(json.dumps(c,indent=2))
PY
docker run --rm --network none --cpus 2 --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$root/graph:/data" "$image" valhalla_build_tiles -j 2 -c /data/config.json /data/map.osm.pbf
python3 - "$root/graph/config.json" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);c=json.loads(p.read_text());c['mjolnir']['tile_dir']=str(p.parent/'tiles');p.write_text(json.dumps(c,indent=2))
assert any((p.parent/'tiles').rglob('*.gph'))
PY
echo ORIGINAL_VALHALLA_NATIVE_GRAPH_READY
