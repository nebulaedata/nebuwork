"""Black-box acceptance against tests/compose.yaml, with an explicit test model fixture."""
import hashlib
import json
import time
import urllib.request
import urllib.error
import uuid
import os
from pathlib import Path

BASE=os.environ.get('NEBULAEKNO_TEST_API_URL','http://127.0.0.1:18080/api/v1')
def request(path,body=None,method=None,headers=None,expected=200):
    headers=dict(headers or {})
    if isinstance(body,(dict,list)):
        body=json.dumps(body,ensure_ascii=False).encode();headers['Content-Type']='application/json'
    req=urllib.request.Request(BASE+path,body,headers,method=method or ('POST' if body is not None else 'GET'))
    try:
        response=urllib.request.urlopen(req,timeout=120)
    except urllib.error.HTTPError as e: response=e
    data=json.load(response)
    assert response.status==expected,(path,response.status,data)
    return data.get('data',data.get('error'))
def multipart(name,data):
    boundary='nebulaekno'+uuid.uuid4().hex
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
    return body,{'Content-Type':'multipart/form-data; boundary='+boundary}
def upload(kb,name,data,key=None):
    body,headers=multipart(name,data)
    if key:headers['Idempotency-Key']=key
    return request('/knowledge-bases/'+kb+'/knowledge/file',body,headers=headers,expected=202)
def wait_task(id,timeout=180):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        task=request('/tasks/'+id)
        if task['state'] not in ('queued','running'):return task
        time.sleep(.5)
    raise AssertionError(('task_timeout',id,task))
def check(condition,message):
    assert condition,message
    print('PASS',message,flush=True)

