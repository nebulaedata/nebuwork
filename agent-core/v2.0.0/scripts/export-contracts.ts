import {mkdir,writeFile} from 'node:fs/promises';
import {createApi} from '../src/api.js';
import {Store} from '../src/store.js';
import {Objects} from '../src/objects.js';
import {eventSchema,manifestJsonSchema,jsonSchema,inputSchema} from '../src/api-schemas.js';
import {testConfig} from '../tests/fixture.js';
// Schema generation has no SQL/object/model side effects.
const store=new Store(testConfig.DATABASE_URL),objects=new Objects(testConfig),api=await createApi(testConfig,store,objects);
try{await api.ready();await mkdir('contracts/v1',{recursive:true});for(const [name,value] of Object.entries({openapi:api.swagger(),'runtime-manifest.schema':manifestJsonSchema,'event.schema':jsonSchema(eventSchema),'run-input.schema':jsonSchema(inputSchema)}))await writeFile(`contracts/v1/${name}.json`,JSON.stringify(value,null,2)+'\n');}finally{await api.close();await store.close();objects.client.destroy();}
