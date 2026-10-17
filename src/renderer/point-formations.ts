// Deterministic 3D point targets, independent from the original vendored sets.
export function tideShape(n:number,kind:string){const a=new Float32Array(n*3),golden=Math.PI*(3-Math.sqrt(5));for(let i=0;i<n;i++){const u=(i+.5)/n,t=i*golden,v=2*u-1,r=Math.sqrt(1-v*v);let x,y,z;
 if(kind==='saturn'){if(i%3===0){const angle=t,ring=1.45+.35*((i*17%997)/997);x=ring*Math.cos(angle);z=ring*Math.sin(angle);y=.14*z;}else{x=r*Math.cos(t);y=v;z=r*Math.sin(t);}}
 else if(kind==='helix'){const h=u*Math.PI*10,side=i%2?1:-1;x=.75*Math.cos(h)*side;y=v*1.8;z=.75*Math.sin(h)*side;}
 else if(kind==='shell'){const h=u*Math.PI*12,s=.15+u*1.7;x=s*Math.cos(h);y=(u-.5)*2;z=s*Math.sin(h);}
 else if(kind==='heart'){const h=u*Math.PI*2,w=Math.sin(t)*.18;x=16*Math.sin(h)**3/10;y=(13*Math.cos(h)-5*Math.cos(2*h)-2*Math.cos(3*h)-Math.cos(4*h))/10;z=w*(1-Math.abs(x)/2);}
 else {const h=u*Math.PI*2;x=1.2*Math.sin(h*3+.7)*Math.cos(t);y=1.2*Math.sin(h*2);z=1.2*Math.cos(h*3+.7)*Math.sin(t);}
 a.set([x,y,z],i*3);}return a;}
