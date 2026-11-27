"""Actual QGIS Processing and GeoPackage roundtrip, public Monaco input."""
import argparse
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent
LOCK=json.loads((ROOT/'inputs.json').read_text())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);args=parser.parse_args()
    folder=Path(args.out).resolve();folder.mkdir(parents=True,exist_ok=True)
    os.environ.setdefault('QT_QPA_PLATFORM','offscreen')
    from qgis.core import (Qgis,QgsApplication,QgsCoordinateReferenceSystem,QgsCoordinateTransform,
        QgsFeature,QgsField,QgsGeometry,QgsPointXY,QgsProject,QgsVectorFileWriter,QgsVectorLayer)
    from qgis.PyQt.QtCore import QVariant
    app=QgsApplication([],False)
    QgsApplication.setPrefixPath('/usr',True)
    app.initQgis()
    sys.path.insert(0,'/usr/share/qgis/python/plugins')
    from processing.core.Processing import Processing
    import processing
    Processing.initialize()
    assert QgsApplication.processingRegistry().algorithmById('native:reprojectlayer')
    source_crs=QgsCoordinateReferenceSystem(LOCK['inputCRS'])
    metric_crs=QgsCoordinateReferenceSystem(LOCK['metricCRS'])
    assert source_crs.isValid() and metric_crs.isValid()
    layer=QgsVectorLayer('Point?crs='+LOCK['inputCRS'],'source','memory')
    provider=layer.dataProvider();assert provider.addAttributes([QgsField('node_id',QVariant.String)])
    layer.updateFields()
    expected={p['id']:(p['lon'],p['lat']) for p in LOCK['points']}
    features=[]
    for ident,(lon,lat) in expected.items():
        f=QgsFeature(layer.fields());f.setAttributes([ident])
        f.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(lon,lat)));features.append(f)
    assert provider.addFeatures(features)[0];layer.updateExtents()
    assert layer.featureCount()==len(expected)
    projected=processing.run('native:reprojectlayer',{'INPUT':layer,'TARGET_CRS':metric_crs,'OUTPUT':'memory:'})['OUTPUT']
    assert projected.isValid() and projected.crs().authid()==LOCK['metricCRS']
    path=folder/'monaco-points.gpkg'
    context=QgsProject.instance().transformContext()
    for item,name,append in [(layer,'source_wgs84',False),(projected,'metric_utm32',True)]:
        options=QgsVectorFileWriter.SaveVectorOptions()
        options.driverName='GPKG';options.layerName=name;options.fileEncoding='UTF-8'
        options.actionOnExistingFile=(QgsVectorFileWriter.CreateOrOverwriteLayer if append else QgsVectorFileWriter.CreateOrOverwriteFile)
        result=QgsVectorFileWriter.writeAsVectorFormatV3(item,str(path),context,options)
        assert result[0]==QgsVectorFileWriter.NoError, result[1]
    del features,f,provider,layer,projected
    rows={}
    for name,crs in [('source_wgs84',source_crs),('metric_utm32',metric_crs)]:
        reopened=QgsVectorLayer(str(path)+'|layername='+name,name,'ogr')
        assert reopened.isValid() and reopened.crs().authid()==crs.authid()
        assert reopened.featureCount()==len(expected)
        transform=QgsCoordinateTransform(crs,source_crs,context)
        points={}
        for feature in reopened.getFeatures():
            ident=feature['node_id'];assert ident in expected and ident not in points
            point=feature.geometry().asPoint()
            wgs=transform.transform(QgsPointXY(point))
            assert abs(wgs.x()-expected[ident][0])<1e-8 and abs(wgs.y()-expected[ident][1])<1e-8
            points[ident]=[point.x(),point.y()]
        rows[name]=points
        del reopened,transform
    p=rows['metric_utm32'];distance=math.dist(p['M1'],p['M2'])
    assert 100<distance<500
    result={'schema':'IWXA_PUBLIC_QGIS_BENCHMARK/1','qgis_version':Qgis.QGIS_VERSION,
        'algorithm':'native:reprojectlayer','source_crs':source_crs.authid(),'target_crs':metric_crs.authid(),
        'point_ids':list(expected),'layers':rows,'metric_m1_m2_metres':distance,
        'geopackage_sha256':sha256(path.read_bytes()).hexdigest(),'geopackage_bytes':path.stat().st_size,
        'network_namespace':os.readlink('/proc/self/ns/net'),'installed_agent_accepted':False}
    (folder/'receipt-qgis.json').write_text(json.dumps(result,indent=2)+'\n')
    print('NATIVE_QGIS_PASS='+json.dumps(result,separators=(',',':')),flush=True)
    # Avoid live Qt-owned layer teardown after QgsApplication destruction.
    app.exitQgis()

if __name__=='__main__':main()
