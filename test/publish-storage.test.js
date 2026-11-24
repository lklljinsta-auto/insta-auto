import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deliveryStore,preparePublishUrl} from '../src/storage/publish-media.js';

test('one private object is reused and a fresh read URL is signed for the approved file',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'insta-publish-'));
  const previous=process.env.MEDIA_SPOOL_DIR;
  process.env.MEDIA_SPOOL_DIR=dir;
  const object=deliveryStore({PUBLISH_S3_BUCKET:'test-bucket',PUBLISH_S3_REGION:'us-east-1',
    PUBLISH_S3_KEY:'test',PUBLISH_S3_SECRET:'offline-only',PUBLISH_S3_ENDPOINT:'https://example.invalid'});
  let stored,puts=0;
  // Exercise the real SDK signer locally. Only the storage transport is replaced.
  object.client.send=async ({input,constructor})=>{
    if(constructor.name==='HeadObjectCommand') return stored;
    assert.equal(input.IfNoneMatch,'*');
    if(stored) throw Object.assign(new Error('exists'),{$metadata:{httpStatusCode:412}});
    const bytes=[];
    for await(const chunk of input.Body) bytes.push(chunk);
    assert.equal(input.ChecksumSHA256,createHash('sha256').update(Buffer.concat(bytes)).digest('base64'));
    stored={ContentLength:input.ContentLength,Metadata:input.Metadata,ContentType:input.ContentType}; puts++;
  };
  try {
    const bytes=Buffer.from('test final file'),sha=createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(dir,sha),bytes);
    const asset={id:randomUUID(),content_version_id:randomUUID(),account_id:randomUUID(),sha256:sha,mime_type:'image/jpeg',size_bytes:bytes.length};
    const issued=new Date();
    const signing=async time=>new URL(await preparePublishUrl(object,asset,time));
    const first=await signing(issued), second=await signing(new Date(issued.valueOf()+3601000));
    assert.equal(puts,1); assert.equal(first.pathname,second.pathname);
    assert.ok(first.pathname.includes(asset.account_id));
    assert.equal(second.searchParams.get('X-Amz-Expires'),'3600');
    assert.notEqual(first.searchParams.get('X-Amz-Signature'),second.searchParams.get('X-Amz-Signature'));
    stored.Metadata={sha256:'changed'};
    await assert.rejects(signing(issued),/differs/);
  }finally {
    object.client.destroy();
    if(previous===undefined) delete process.env.MEDIA_SPOOL_DIR;else process.env.MEDIA_SPOOL_DIR=previous;
    await rm(dir,{recursive:true,force:true});
  }
});
