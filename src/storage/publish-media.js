import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// The archive is private. Only this immutable, account-scoped object is signed for a reader.
export function deliveryStore(env=process.env) {
  if (!env.PUBLISH_S3_BUCKET || !env.PUBLISH_S3_REGION || !env.PUBLISH_S3_KEY || !env.PUBLISH_S3_SECRET)
    return null;
  if (env.PUBLISH_S3_ENDPOINT && new URL(env.PUBLISH_S3_ENDPOINT).protocol!=='https:')
    throw new Error('HTTPS required for publication storage');
  const client=new S3Client({
    region:env.PUBLISH_S3_REGION,endpoint:env.PUBLISH_S3_ENDPOINT||undefined,
    credentials:{accessKeyId:env.PUBLISH_S3_KEY,secretAccessKey:env.PUBLISH_S3_SECRET},
    requestChecksumCalculation:'WHEN_REQUIRED'
  });
  return {client,bucket:env.PUBLISH_S3_BUCKET};
}
export async function preparePublishUrl({client,bucket},asset,now=new Date()) {
  if(!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid staged digest');
  const src=path.join(path.resolve(process.env.MEDIA_SPOOL_DIR||'.instaauto-media'),asset.sha256);
  const size=Number(asset.size_bytes);
  if((await stat(src)).size!==size) throw new Error('Staged size mismatch');
  const key=['publication',asset.account_id,asset.content_version_id,asset.id,asset.sha256].join('/');
  const object={Bucket:bucket,Key:key};
  const body=createReadStream(src);
  try {
    await client.send(new PutObjectCommand({...object,Body:body,ContentType:asset.mime_type,
      ContentLength:size,Metadata:{sha256:asset.sha256},IfNoneMatch:'*',
      ChecksumSHA256:Buffer.from(asset.sha256,'hex').toString('base64')}),{abortSignal:AbortSignal.timeout(90000)});
  } catch(error) {
    if(error.$metadata?.httpStatusCode!==412) throw error;
    const prior=await client.send(new HeadObjectCommand(object),{abortSignal:AbortSignal.timeout(15000)});
    if(prior.ContentLength!==size || prior.Metadata?.sha256!==asset.sha256 || prior.ContentType!==asset.mime_type)
      throw new Error('Publication object differs from archive');
  } finally {body.destroy();}
  const url=await getSignedUrl(client,new GetObjectCommand(object),{expiresIn:3600,signingDate:now});
  if(new URL(url).protocol!=='https:') throw new Error('Invalid publication URL');
  return url;
}
