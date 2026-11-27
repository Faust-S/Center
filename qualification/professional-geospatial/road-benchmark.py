"""Run original pinned road programs on the same local public map bytes.

No customer data, no private source, no mocked engine, no public route API.
Preparation containers and running engines use Docker network=none.
nsenter joins only the running container's network namespace to query loopback
using the runner's ordinary Python client. This is a native comparison, not an
installed IWXA product test. A successful route is not road-access proof.
"""
import argparse
from contextlib import contextmanager
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode

from topology_fixture import POINTS, SHORTCUT_MIDDLE, DETOUR_MIDDLE, write as write_topology

ROOT=Path(__file__).resolve().parent
LOCK=json.loads((ROOT/'inputs.json').read_text())
MEASURE_TIMEOUT=180
# Graph file permissions must belong to the runner that verifies exact bytes.
CONTAINER_USER=f'{os.getuid()}:{os.getgid()}'
CLIENT = r"""
import sys,json,urllib.request,urllib.error
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open('http://127.0.0.1:'+sys.argv[1]+sys.argv[2],timeout=15) as response:
        raw=response.read(4*1024*1024+1);status=response.status
except urllib.error.HTTPError as e:
    raw=e.read(4*1024*1024+1);status=e.code
assert len(raw)<=4*1024*1024
print(json.dumps({'http_status':status,'data':json.loads(raw)}))
"""

def need(value,code):
    if not value: raise RuntimeError(code)

def run(args,timeout=MEASURE_TIMEOUT,check=True,stdin=None):
    p=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        timeout=timeout,check=False)
    if check and p.returncode:
        print('NATIVE_COMMAND_FAILED',args[:6],p.returncode,p.stderr.decode(errors='replace')[-3000:],flush=True)
        raise RuntimeError('native_command_failed')
    return p

def output(args,**kw):
    return run(args,**kw).stdout.decode('utf-8').strip()

def dump(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def hash_file(p):
    return sha256(p.read_bytes()).hexdigest()

def finite(v):
    return type(v) in (float,int) and math.isfinite(v) and v>=0

def distance(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8*2*math.asin(min(1,math.sqrt(h)))

def coords(p):
    return [p['lon'],p['lat']]

def polyline6(text):
    need(type(text) is str and 0<len(text)<=2_000_000,'valhalla_shape_invalid')
    result=[];i=0;lat=lon=0
    def delta():
        nonlocal i
        n=shift=0
        while True:
            need(i<len(text) and shift<=35,'valhalla_shape_truncated')
            c=ord(text[i])-63;i+=1
            need(0<=c<=63,'valhalla_shape_character')
            n|=(c&31)<<shift;shift+=5
            if c<32:return ~(n>>1) if n&1 else n>>1
    while i<len(text):
        lat+=delta();lon+=delta()
        result.append([lon/1e6,lat/1e6])
    return result

def geometry_check(shape,a,b,max_snap):
    need(type(shape) is list and len(shape)>=2,'route_geometry_missing')
    need(all(type(p) is list and len(p)==2 and all(type(x) in (int,float) and math.isfinite(x) for x in p)
             and -180<=p[0]<=180 and -90<=p[1]<=90 for p in shape),'route_geometry_invalid')
    snaps=[distance(coords(a),shape[0]),distance(coords(b),shape[-1])]
    need(max(snaps)<=max_snap,'route_snap_outside_limit')
    return {'point_count':len(shape),'endpoint_snap_metres':snaps,'shape':shape}

def passes_near(route,point,threshold=50):
    if route.get('status')!='FOUND': return False
    # Local tangent-plane distance to a line segment on the tiny controlled
    # topology, independent of the routing engine's graph and cost function.
    def project(p):
        return ((p[0]-point[0])*111195*math.cos(math.radians(point[1])),
                (p[1]-point[1])*111195)
    path=[project(p) for p in route['shape']]
    for a,b in zip(path,path[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        d=dx*dx+dy*dy
        t=min(1,max(0,-(a[0]*dx+a[1]*dy)/d)) if d else 0
        if math.hypot(a[0]+t*dx,a[1]+t*dy)<=threshold:return True
    return False

def matrix_rows(times,distances,n,scale):
    need(type(times) is list and len(times)==n and type(distances) is list and len(distances)==n,'matrix_rows')
    result=[]
    for i,(tr,dr) in enumerate(zip(times,distances)):
        need(type(tr) is list and len(tr)==n and type(dr) is list and len(dr)==n,'matrix_columns')
        row=[]
        for j,(t,d) in enumerate(zip(tr,dr)):
            if t is None or d is None:
                need(t is None and d is None and i!=j,'matrix_partial_or_diagonal_null')
                row.append(None)
            else:
                need(finite(t) and finite(d),'matrix_non_finite')
                if i==j: need(t==0 and d==0,'matrix_diagonal')
                row.append({'seconds':t,'metres':d*scale})
        result.append(row)
    return result

def matrix_asymmetry(m):
    return sum(m[i][j]!=m[j][i] for i in range(len(m)) for j in range(i+1,len(m)))

class Engine:
    def __init__(self,name,image,folder,command,port):
        self.name=name;self.image=image;self.folder=folder;self.command=command;self.port=port
        self.container='';self.pid=0
    def __enter__(self):
        self.container=output(['docker','run','-d','--network','none','--cpus','2','--user',CONTAINER_USER,'--env','HOME=/tmp',
            '-v',str(self.folder)+':/data:ro',self.image,*self.command])
        try:
            inspect=json.loads(output(['docker','inspect',self.container]))[0]
            need(inspect['HostConfig']['NetworkMode']=='none','engine_network_not_isolated')
            self.pid=inspect['State']['Pid']
            need(type(self.pid) is int and self.pid>0,'engine_process_not_running')
            return self
        except BaseException:
            self.__exit__(None,None,None)
            raise
    def __exit__(self,*unused):
        if self.container:
            run(['docker','rm','-f',self.container],check=False,timeout=20)
    def get(self,path):
        t=time.perf_counter()
        raw=output(['sudo','nsenter','-t',str(self.pid),'-n','--','/usr/bin/python3','-c',CLIENT,str(self.port),path],timeout=25)
        result=json.loads(raw)
        return result['http_status'],result['data'],(time.perf_counter()-t)*1000
    def ready(self,path):
        for _ in range(45):
            try:
                status,body,_=self.get(path)
                if status==200:return body
            except (RuntimeError,subprocess.TimeoutExpired,ValueError):
                pass
            time.sleep(1)
        logs=run(['docker','logs','--tail','30',self.container],check=False)
        print(logs.stdout.decode(errors='replace')[-5000:],logs.stderr.decode(errors='replace')[-5000:],flush=True)
        raise RuntimeError('engine_readiness_timeout')
    def memory(self):
        info=output(['docker','stats','--no-stream','--format','{{json .}}',self.container],timeout=25)
        d=json.loads(info)
        return {'memory_usage':d.get('MemUsage'),'cpu_percent':d.get('CPUPerc')}

def container(image,folder,*cmd,timeout=MEASURE_TIMEOUT):
    return run(['docker','run','--rm','--network','none','--cpus','2','--user',CONTAINER_USER,'--env','HOME=/tmp','-v',str(folder)+':/data',image,*cmd],timeout=timeout)

def files_manifest(folder):
    return [{'path':str(p.relative_to(folder)),'bytes':p.stat().st_size,'sha256':hash_file(p)}
            for p in sorted(folder.rglob('*')) if p.is_file() and p.name!='map.osm.pbf']

def prepare_osrm(folder):
    image=LOCK['osrm']['image'];started=time.perf_counter()
    version=container(image,folder,'osrm-routed','--version').stdout.decode().strip()
    need(LOCK['osrm']['version'] in version,'osrm_native_version_changed')
    profile=container(image,folder,'sh','-c','find /opt -type f -name "*.lua" -print0 | sort -z | xargs -0 sha256sum').stdout.decode().strip()
    need('/opt/car.lua' in profile,'osrm_car_profile_missing')
    container(image,folder,'osrm-extract','-t','2','-p','/opt/car.lua','/data/map.osm.pbf')
    container(image,folder,'osrm-partition','-t','2','/data/map.osrm')
    container(image,folder,'osrm-customize','-t','2','/data/map.osrm')
    return {'version':version,'image':image,'profile':'car.lua','algorithm':'mld',
            'profile_files':profile,'build_seconds':time.perf_counter()-started,
            'files':files_manifest(folder)}

def prepare_valhalla(folder):
    image=LOCK['valhalla']['image'];started=time.perf_counter()
    version=container(image,folder,'valhalla_service','--version').stdout.decode().strip()
    need(LOCK['valhalla']['version'] in version,'valhalla_native_version_changed')
    cfg=json.loads(container(image,folder,'valhalla_build_config').stdout)
    m=cfg['mjolnir']
    m.update(tile_dir='/data/tiles',tile_extract='',traffic_extract='',tile_url='',admin='',timezone='')
    m['data_processing']['use_admin_db']=False
    m['data_processing']['apply_country_overrides']=False
    cfg['httpd']['service']['listen']='tcp://127.0.0.1:8002'
    # Use only built local graph, no elevation/traffic/remote tile downloads.
    for k in ('additional_data','tile_url'):
        m.pop(k,None)
    dump(folder/'config.json',cfg)
    container(image,folder,'valhalla_build_tiles','-j','2','-c','/data/config.json','/data/map.osm.pbf')
    need(any((folder/'tiles').rglob('*.gph')),'valhalla_graph_missing')
    return {'version':version,'image':image,'config_sha256':hash_file(folder/'config.json'),
            'build_seconds':time.perf_counter()-started,'files':files_manifest(folder)}

def osrm_path(action,points,radius=100):
    c=';'.join(f"{p['lon']:.6f},{p['lat']:.6f}" for p in points)
    q={'radiuses':';'.join(str(radius) for p in points),'generate_hints':'false'}
    if action=='table':q['annotations']='duration,distance'
    else:q.update(overview='full',geometries='geojson',steps='false',alternatives='false')
    return '/'+action+'/v1/driving/'+c+'?'+urlencode(q,safe=';,')
def valhalla_path(action,points,costing='auto',options=None,radius=100):
    locations=[{'lat':p['lat'],'lon':p['lon'],'search_cutoff':radius,'radius':radius,
                'minimum_reachability':0} for p in points]
    req={'costing':costing,'units':'kilometers'}
    if options: req['costing_options']={costing:options}
    if action=='sources_to_targets':req.update(sources=locations,targets=locations,verbose=False)
    else:req.update(locations=locations,shape_format='polyline6',directions_type='none')
    return '/'+action+'?'+urlencode({'json':json.dumps(req,separators=(',',':'))})

def osrm_matrix(e,points,radius):
    status,data,ms=e.get(osrm_path('table',points,radius))
    need(status==200 and data.get('code')=='Ok' and not data.get('fallback_speed_cells'),'osrm_matrix_not_native')
    for name in ('sources','destinations'):
        rows=data.get(name)
        need(type(rows) is list and len(rows)==len(points),'osrm_snap_rows')
        for p,w in zip(points,rows):
            need(finite(w.get('distance')) and w['distance']<=radius
                 and distance(coords(p),w['location'])<=radius+1,'osrm_snap_outside_limit')
    return matrix_rows(data['durations'],data['distances'],len(points),1),ms,data

def valhalla_matrix(e,points,radius,costing='auto',options=None):
    status,data,ms=e.get(valhalla_path('sources_to_targets',points,costing,options,radius))
    need(status==200 and data.get('units')=='kilometers' and not data.get('error_code'),'valhalla_matrix_not_native')
    table=data['sources_to_targets']
    need(type(table) is dict,'valhalla_concise_table_missing')
    return matrix_rows(table['durations'],table['distances'],len(points),1000),ms,data

def osrm_route(e,a,b,radius):
    status,data,ms=e.get(osrm_path('route',[a,b],radius))
    if status!=200:
        need(data.get('code') in ('NoRoute','NoSegment'),'osrm_route_failed_unexpectedly')
        return {'status':'UNREACHABLE','native_code':data['code'],'request_ms':ms}
    need(data.get('code')=='Ok' and len(data.get('routes',[]))==1,'osrm_route_failed')
    row=data['routes'][0]
    need(finite(row['duration']) and finite(row['distance']) and row['geometry']['type']=='LineString','osrm_route_measurement')
    return {'status':'FOUND','seconds':row['duration'],'metres':row['distance'],
        'request_ms':ms,**geometry_check(row['geometry']['coordinates'],a,b,radius)}

def valhalla_route(e,a,b,radius,costing='auto',options=None):
    status,data,ms=e.get(valhalla_path('route',[a,b],costing,options,radius))
    if status!=200:
        # Preserve actual native error; only known disconnected/unsnappable
        # codes classify as no route. Other failures block qualification.
        need(data.get('error_code') in (170,171,442),'valhalla_route_failed_unexpectedly')
        return {'status':'UNREACHABLE','native_code':data['error_code'],'request_ms':ms}
    trip=data['trip'];summary=trip['summary'];legs=trip['legs']
    need(trip.get('status')==0 and trip.get('units')=='kilometers' and len(legs)==1
         and finite(summary['time']) and finite(summary['length']),'valhalla_route_measurement')
    return {'status':'FOUND','seconds':summary['time'],'metres':summary['length']*1000,
        'request_ms':ms,**geometry_check(polyline6(legs[0]['shape']),a,b,radius)}

def compare_matrix_routes(matrix,routes,points):
    result=[]
    for i,a in enumerate(points):
        for j,b in enumerate(points):
            if i==j:continue
            route=routes[f"{a['id']}->{b['id']}"]
            cell=matrix[i][j]
            found=route['status']=='FOUND'
            row={'from':a['id'],'to':b['id'],'matrix_reachable':cell is not None,'route_reachable':found}
            if cell is not None and found:
                row.update(delta_seconds=route['seconds']-cell['seconds'],
                           delta_metres=route['metres']-cell['metres'])
            result.append(row)
    return result

def run_pair(folder,points,kind,receipt):
    radius=LOCK['max_snap_metres'] if kind=='monaco' else 25
    meta={}
    for name in ('osrm','valhalla'):
        p=folder/name;p.mkdir()
        run(['cp',str(folder/'map.osm.pbf'),str(p/'map.osm.pbf')])
        meta[name]=(prepare_osrm if name=='osrm' else prepare_valhalla)(p)
        dump(receipt.parent/f'engine-{kind}-{name}.json',meta[name])
        print('NATIVE_MAP_BUILT',kind,name,meta[name]['version'],flush=True)
    observed={}
    for name in ('osrm','valhalla'):
        command=['osrm-routed','--algorithm','mld','--threads','2','/data/map.osrm'] if name=='osrm' else ['valhalla_service','/data/config.json','1']
        port=5000 if name=='osrm' else 8002
        with Engine(name,LOCK[name]['image'],folder/name,command,port) as engine:
            make_matrix=osrm_matrix if name=='osrm' else valhalla_matrix
            make_route=osrm_route if name=='osrm' else valhalla_route
            ready=osrm_path('route',points[:2],radius) if name=='osrm' else valhalla_path('route',points[:2],radius=radius)
            engine.ready(ready)
            matrix,ms,raw=make_matrix(engine,points,radius)
            runs=[]
            for _ in range(3):
                repeat,elapsed,_=make_matrix(engine,points,radius)
                need(repeat==matrix,'native_matrix_repeat_changed')
                runs.append(elapsed)
            routes={}
            for i,a in enumerate(points):
                for j,b in enumerate(points):
                    if i!=j:routes[f"{a['id']}->{b['id']}"]=make_route(engine,a,b,radius)
            compare=compare_matrix_routes(matrix,routes,points)
            observed[name]={'matrix':matrix,'native_matrix':raw,'first_request_ms':ms,'repeat_request_ms':runs,
                'asymmetric_pairs':matrix_asymmetry(matrix),'routes':routes,'matrix_route_differences':compare,
                'memory_observation':engine.memory(),'network_mode':'none'}
            if kind=='monaco':
                need(all(row['matrix_reachable'] and row['route_reachable'] for row in compare),'monaco_route_missing')
            else:
                # Report differences and profile support, not an automatic
                # approval for any vehicle. The controlled reference is exact.
                if name=='valhalla':
                    options={'height':2.0,'width':2.0,'length':6.0,'weight':4.0,'axle_load':2.0,'axle_count':2}
                    variants={'small':options}
                    for k,v in [('height',3.5),('width',2.5),('length',10.0),('weight',10.0),('axle_load',4.0)]:
                        variants[k]={**options,k:v}
                    profiles={}
                    for k,profile in variants.items():
                        m,elapsed,native=make_matrix(engine,points[:2],radius,'truck',profile)
                        route=make_route(engine,points[0],points[1],radius,'truck',profile)
                        profiles[k]={'options':profile,'matrix':m,'native_matrix':native,'request_ms':elapsed,'route':route}
                    observed[name]['truck_profiles']=profiles
            dump(receipt,{'kind':kind,'map_sha256':hash_file(folder/'map.osm.pbf'),'points':points,'engines':observed,
                          'qualification_scope':'NATIVE_PUBLIC_BENCHMARK_ONLY'})
            print('ROAD_ENGINE_OBSERVED',kind,name,'asymmetric_pairs',observed[name]['asymmetric_pairs'],
                  'matrix_route_reachability_mismatches',sum(x['matrix_reachable']!=x['route_reachable'] for x in compare),
                  'median_client_request_ms',sorted(runs)[1],flush=True)
    return observed

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);args=parser.parse_args()
    folder=Path(args.out).resolve();folder.mkdir(parents=True,exist_ok=True)
    for name in ('osrm','valhalla'):run(['docker','pull',LOCK[name]['image']],timeout=600)
    real=folder/'monaco';real.mkdir()
    mapfile=real/'map.osm.pbf'
    run(['curl','--fail','--location','--retry','2','--max-time','90',LOCK['osm']['url'],'-o',str(mapfile)],timeout=100)
    need(mapfile.stat().st_size==LOCK['osm']['bytes'],'osm_input_size_changed')
    need(output(['git','hash-object',str(mapfile)])==LOCK['osm']['git_blob'],'osm_input_blob_changed')
    dump(folder/'receipt-map-source.json',{**LOCK['osm'],'sha256':hash_file(mapfile),
        'fileinfo':json.loads(output(['osmium','fileinfo','-e','-j',str(mapfile)]))})
    run_pair(real,LOCK['points'],'monaco',folder/'receipt-monaco.json')
    controlled=folder/'topology';controlled.mkdir()
    write_topology(controlled/'fixture.osm')
    run(['osmium','cat',str(controlled/'fixture.osm'),'-o',str(controlled/'map.osm.pbf')])
    observed=run_pair(controlled,POINTS,'topology',folder/'receipt-topology.json')
    # Record native observations without conflating absence of a restriction
    # response with physical access. Explicitly distinguish route vs matrix.
    rows=[]
    for name,o in observed.items():
        a=o['matrix'][2][3];b=o['matrix'][3][2]
        forward=o['routes']['ONE_A->ONE_B'];reverse=o['routes']['ONE_B->ONE_A']
        rows.append({'engine':name,'one_way_forward':a,'one_way_reverse':b,
          'one_way_direction_verified':bool(a and b and b['metres']>a['metres']+100
             and forward['status']==reverse['status']=='FOUND' and reverse['metres']>forward['metres']+100),
          'island_matrix':o['matrix'][0][4],'island_route':o['routes']['START->ISLAND']['status'],
          'disconnected_verified':o['matrix'][0][4] is None and o['routes']['START->ISLAND']['status']=='UNREACHABLE'})
    trucks=observed['valhalla']['truck_profiles']
    def summary(x):
        route=x['route'];cell=x['matrix'][0][1]
        shortcut=passes_near(route,SHORTCUT_MIDDLE)
        detour=passes_near(route,DETOUR_MIDDLE)
        return {'options':x['options'],'matrix':cell,
          'route_status':route['status'],'route_metres':route.get('metres'),
          'uses_restricted_shortcut':shortcut,'uses_detour':detour,
          'matrix_route_delta_metres':route['metres']-cell['metres'] if cell is not None and route['status']=='FOUND' else None}
    truck_observations={k:summary(v) for k,v in trucks.items()}
    small=truck_observations['small']
    truck_checks={'small_reference_uses_shortcut':small['route_status']=='FOUND' and small['uses_restricted_shortcut']}
    for k,v in truck_observations.items():
        if k!='small':
            truck_checks[k+'_restriction_route_verified']=bool(v['route_status']=='FOUND'
                and not v['uses_restricted_shortcut'] and v['uses_detour'])
            truck_checks[k+'_matrix_avoids_shortcut_distance']=bool(small['matrix'] is not None and v['matrix'] is not None
                and v['matrix']['metres']>small['matrix']['metres']+100)
    verdict={'matrix_direction_and_disconnected':rows,'truck_observations':truck_observations,'truck_checks':truck_checks,
              'status':'OBSERVED_NOT_ENGINE_SELECTED','physical_access_proven':False,'installed_iwxa_accepted':False}
    dump(folder/'receipt-comparison.json',verdict)
    print('PUBLIC_ROAD_COMPARISON='+json.dumps(verdict,separators=(',',':'),allow_nan=False),flush=True)

if __name__=='__main__':main()
