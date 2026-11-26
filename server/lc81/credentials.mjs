import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
const options=Object.freeze({N:32768,r:8,p:1,maxmem:64*1024*1024});
export function normalizeLogin(value){
 if(typeof value!=='string')return null;
 const s=value.trim().toLowerCase();
 return /^[a-z0-9][a-z0-9._+@-]{0,127}$/.test(s)&&(!s.includes('@')||/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(s))?s:null;
}
export function validPassword(s){return typeof s==='string'&&Buffer.byteLength(s,'utf8')>=12&&Buffer.byteLength(s,'utf8')<=128&&!/[\u0000-\u001f\u007f]/.test(s)}
export const generatePassword=()=>randomBytes(24).toString('base64url');
export function hashPassword(password){
 if(!validPassword(password))throw Error('Пароль: от 12 до 128 байт, без управляющих символов');
 const salt=randomBytes(16);
 return 'scrypt-v1:'+salt.toString('hex')+':'+scryptSync(password,salt,32,options).toString('hex');
}
export const validHash=h=>typeof h==='string'&&/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(h);
const dummy=hashPassword(generatePassword());
export function verifyPassword(password,stored){
 if(!validPassword(password))return false;
 const good=validHash(stored),[,salt,key]=(good?stored:dummy).split(':');
 const calculated=scryptSync(password,Buffer.from(salt,'hex'),32,options);
 return timingSafeEqual(calculated,Buffer.from(key,'hex'))&&good;
}
export const tokenDigest=s=>createHash('sha256').update(s).digest('hex');
