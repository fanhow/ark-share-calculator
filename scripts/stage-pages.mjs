import {copyFile, lstat, mkdir, readdir, rm} from 'node:fs/promises';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const rootDir=fileURLToPath(new URL('../',import.meta.url));
const publicExtensions=new Set(['.html','.css','.js','.md','.json']);
const excluded=new Set(['package.json','package-lock.json','npm-shrinkwrap.json']);

// Publish root web assets and intentional data JSON only, never the whole checkout.
export async function stagePages(root=rootDir){
 const destination=join(root,'_site'),copied=[];
 await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
 const copy=async(relative)=>{const target=join(destination,relative);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(join(root,relative),target);copied.push(relative);};
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isFile()||excluded.has(entry.name))continue;
  if(entry.name==='.nojekyll'||(!entry.name.startsWith('.')&&publicExtensions.has(extname(entry.name).toLowerCase())))await copy(entry.name);
 }
 const data=async(relative)=>{
  let entries;try{entries=await readdir(join(root,relative),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){
   if(entry.name.startsWith('.'))continue;
   const path=join(relative,entry.name);
   if(entry.isDirectory())await data(path);else if(entry.isFile()&&extname(entry.name).toLowerCase()==='.json')await copy(path);
  }
 };
 let dataEntry;try{dataEntry=await lstat(join(root,'data'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(dataEntry){if(!dataEntry.isDirectory()||dataEntry.isSymbolicLink())throw Error('data must be a real directory, not a symbolic link.');await data('data');}
 if(!copied.includes('index.html'))throw Error('The public website must include index.html.');
 return copied.sort();
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 console.log('Staged public files: '+(await stagePages()).length);
}
