"""Controlled OSM topology for directional access tests, never a real road map."""
import xml.etree.ElementTree as ET

POINTS = [
    {'id':'START','lon':10.001,'lat':40.000},
    {'id':'END','lon':10.009,'lat':40.000},
    {'id':'ONE_A','lon':10.002,'lat':40.010},
    {'id':'ONE_B','lon':10.008,'lat':40.010},
    {'id':'ISLAND','lon':10.032,'lat':40.020},
]
SHORTCUT_MIDDLE = (10.005,40.0)
DETOUR_MIDDLE = (10.005,40.004)

def write(path):
    root=ET.Element('osm',version='0.6',generator='IWXA public topology test')
    coords = {
      1:(10,40),2:(10.002,40),3:(10.008,40),4:(10.010,40),
      5:(10.002,40.004),6:(10.008,40.004),
      11:(10,40.01),12:(10.010,40.01),13:(10.010,40.016),14:(10,40.016),
      15:(10,40.004),21:(10.030,40.020),22:(10.034,40.020),23:(10.034,40.023),24:(10.030,40.023)}
    for i,(lon,lat) in sorted(coords.items()):
        ET.SubElement(root,'node',id=str(i),lon=str(lon),lat=str(lat),version='1',
                      timestamp='2025-01-01T00:00:00Z',uid='1',user='fixture',changeset='1')
    def way(wid,ns,tags):
        w=ET.SubElement(root,'way',id=str(wid),version='1',timestamp='2025-01-01T00:00:00Z',
                       uid='1',user='fixture',changeset='1')
        for n in ns: ET.SubElement(w,'nd',ref=str(n))
        for k,v in {'highway':'secondary','name':'Fixture '+str(wid),'maxspeed':'40',**tags}.items():
            ET.SubElement(w,'tag',k=k,v=v)
    way(101,[1,2],{})
    way(102,[2,3],{'maxheight':'2.5','maxwidth':'2.2','maxlength':'8','maxweight':'5','maxaxleload':'3'})
    way(103,[3,4],{})
    way(104,[2,5,6,3],{})
    way(105,[1,15,11],{})
    way(106,[11,12,13,14,11],{'oneway':'yes'})
    way(107,[21,22,23,24,21],{})
    ET.ElementTree(root).write(path,encoding='utf-8',xml_declaration=True)
