// Original Lens scene painter, extracted from internal/renderer.js at 7a424c9.
// Copyright (c) 2026 DayDreamInAReverie, MIT. Only the showcase greeting is omitted.
export function paintLensBackground(ctx, {width:w,height:h,dpr,scene:name}) {
      const palettes={aurora:['#d3e8e3','#badde8','#9db7dc','#929ee0','#d3b4d2','#eccbc1'],sunset:['#f2dfbd','#f5cdaf','#e7a59c','#c387a2','#9f89b2','#dcb9c3'],ocean:['#326975','#286d85','#225879','#293e68','#4a5486','#7184a3']};
      if(name==='grid'){
        ctx.fillStyle='#e8ebef';ctx.fillRect(0,0,w,h);ctx.lineWidth=dpr;
        const step=34*dpr;
        for(let x=0;x<w;x+=step){ctx.strokeStyle=Math.round(x/step)%4===0?'#a1acbb':'#c4cbd5';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
        for(let y=0;y<h;y+=step){ctx.strokeStyle=Math.round(y/step)%4===0?'#a1acbb':'#c4cbd5';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
      }else{
        const p=palettes[name]||palettes.aurora;
        const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,p[0]);gradient.addColorStop(.5,p[1]);gradient.addColorStop(1,p[5]);ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
        // Raised, curved color sheets: directional face gradients, soft inter-layer
        // occlusion and a broad grazing highlight, baked once when a scene changes.
        const ribbon=(offset,color1,color2)=>{
          const contour=new Path2D();contour.moveTo(-w*.1,h*(.98+offset));
          contour.bezierCurveTo(w*.13,h*(.39+offset),w*.48,h*(.86+offset),w*1.1,h*(-.32+offset));
          const shape=new Path2D(contour);shape.lineTo(w*1.15,h*1.4);shape.lineTo(-w*.1,h*1.4);shape.closePath();
          const g=ctx.createLinearGradient(w*.05,h*.1,w*.87,h*.92);g.addColorStop(0,color1);g.addColorStop(.48,color2);g.addColorStop(1,p[5]);
          ctx.save();ctx.shadowColor=name==='ocean'?'#0b23484a':'#38486830';ctx.shadowBlur=27*dpr;ctx.shadowOffsetY=-7*dpr;ctx.fillStyle=g;ctx.fill(shape);ctx.restore();
          ctx.save();ctx.clip(shape);
          ctx.filter=`blur(${15*dpr}px)`;ctx.strokeStyle=name==='ocean'?'#bce9ff24':'#ffffff45';ctx.lineWidth=37*dpr;ctx.stroke(contour);
          ctx.filter='none';ctx.strokeStyle='#ffffff25';ctx.lineWidth=1.2*dpr;ctx.stroke(contour);
          const roll=ctx.createLinearGradient(0,h*(.25+offset),w*.7,h*(1.08+offset));roll.addColorStop(0,'#ffffff00');roll.addColorStop(.45,'#ffffff00');roll.addColorStop(.72,'#324e7e13');roll.addColorStop(1,'#ffffff1c');ctx.fillStyle=roll;ctx.fill(shape);
          ctx.restore();
        };
        ribbon(-.31,p[1],p[2]);ribbon(-.10,p[2],p[3]);ribbon(.18,p[3],p[4]);ribbon(.44,p[4],p[5]);
        const glow=ctx.createRadialGradient(w*.12,h*.08,0,w*.12,h*.08,w*.85);glow.addColorStop(0,'#ffffff55');glow.addColorStop(1,'#ffffff00');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
      }
}
