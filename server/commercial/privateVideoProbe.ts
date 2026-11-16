import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdtemp,chmod,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {probePrivateVideo,UploadError} from './resumableUploads';
import {FileFault,type FileProbe} from './firestoreFiles';
import type {CloudObjects} from './gcsObjects';

export function privateVideoProbe(objects:CloudObjects):FileProbe {
  return {async inspect(object,expectedSha,signal){
    const directory=await mkdtemp(join(tmpdir(),'vistavo-file-'));await chmod(directory,0o700);
    const file=join(directory,'input.mp4'),hash=createHash('sha256');let size=0;
    try{
      const counter=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;
        if(size>object.size){callback(new FileFault('invalid'));return;}hash.update(chunk);callback(null,chunk);}});
      await pipeline(await objects.read(object),counter,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
      if(signal.aborted)throw new FileFault('unavailable');
      const sha256=hash.digest('hex');if(size!==object.size||sha256!==expectedSha)throw new FileFault('invalid');
      let video;try{video=await probePrivateVideo(file);}catch(error){throw new FileFault(signal.aborted||(error instanceof UploadError&&error.transient)?'unavailable':'invalid');}
      if(signal.aborted)throw new FileFault('unavailable');return {sha256,video};
    }finally{await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}
  }};
}
