// Lattice coordinate generation and layout calculations

import { state } from '../state.js';

let _candidateCacheKey = '';
let _candidateCacheFlat = null;
let _candidateCacheLen = 0;

export function calculateTargetPositions() {
    const cacheKey = `${state.currentLayout}|${state.currentFillMode}|${state.linearStride}`;
    if (cacheKey !== _candidateCacheKey || !_candidateCacheFlat) {
        let candidates = [];
        let range = 45;
        if (state.currentLayout === 'tetra' || state.currentLayout === 'rhombic') range = 58;
        if (state.currentLayout === 'triangular') range = 62;
        if (state.currentLayout === 'omnitruncated') range = 36;
        if (state.currentLayout === 'gyroid') range = 55;

        if (state.currentLayout === 'cube') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x,y,z});
        } else if (state.currentLayout === 'hexagonal' || state.currentLayout === 'triangular') {
            const s3=Math.sqrt(3);
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x:x+(Math.abs(y)%2)*0.5,y:y*(s3/2),z});
        } else if (state.currentLayout === 'octahedral' || state.currentLayout === 'bitruncated') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
        } else if (state.currentLayout === 'tetra' || state.currentLayout === 'rhombic') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) if(Math.abs(x+y+z)%2===0) candidates.push({x,y,z});
        } else if (state.currentLayout === 'omnitruncated') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x:x*2,y:y*2,z:z*2}); candidates.push({x:x*2+1,y:y*2+1,z:z*2+1}); }
        } else if (state.currentLayout === 'aperiodic') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const s=(x*123+y*456+z*789);
                candidates.push({x:x+Math.sin(s)*0.5,y:y+Math.cos(s)*0.5,z:z+Math.sin(s*0.5)*0.5});
            }
        } else if (state.currentLayout === 'hcp') {
            const s3=Math.sqrt(3),cz=Math.sqrt(2/3);
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const even=(Math.abs(z)%2===0);
                candidates.push({x:x+(Math.abs(y)%2)*0.5+(even?0:0.5),y:y*(s3/2)+(even?0:s3/6),z:z*cz});
            }
        } else if (state.currentLayout === 'diamond_c') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                if(Math.abs(x+y+z)%2===0) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
            }
        } else if (state.currentLayout === 'gyroid') {
            const sc=0.3;
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const f=Math.abs(Math.sin(x*sc)*Math.cos(y*sc)+Math.sin(y*sc)*Math.cos(z*sc)+Math.sin(z*sc)*Math.cos(x*sc));
                if(f<0.5) candidates.push({x,y,z});
            }
        }

        if      (state.currentFillMode==='shell')   candidates.sort((a,b)=>(a.x*a.x+a.y*a.y+a.z*a.z)-(b.x*b.x+b.y*b.y+b.z*b.z));
        else if (state.currentFillMode==='cubic')   candidates.sort((a,b)=>Math.max(Math.abs(a.x),Math.abs(a.y),Math.abs(a.z))-Math.max(Math.abs(b.x),Math.abs(b.y),Math.abs(b.z)));
        else if (state.currentFillMode==='diamond') candidates.sort((a,b)=>(Math.abs(a.x)+Math.abs(a.y)+Math.abs(a.z))-(Math.abs(b.x)+Math.abs(b.y)+Math.abs(b.z)));
        else if (state.currentFillMode==='linear') {
            if (state.linearStride<=0) {
                candidates.sort((a,b)=>(a.z-b.z)||(a.y-b.y)||(a.x-b.x));
            } else {
                const W=state.linearStride;
                const xMin=candidates.reduce((m,c)=>Math.min(m,c.x),Infinity);
                candidates.sort((a,b)=>{
                    if(a.z!==b.z) return a.z-b.z;
                    const sA=Math.floor((a.x-xMin)/W), sB=Math.floor((b.x-xMin)/W);
                    if(sA!==sB) return sA-sB;
                    if(a.y!==b.y) return a.y-b.y;
                    return a.x-b.x;
                });
            }
        }
        else if (state.currentFillMode==='vortex')  candidates.sort((a,b)=>(Math.abs(a.z-b.z)>0.5?a.z-b.z:Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x)));
        else if (state.currentFillMode==='outside') candidates.sort((a,b)=>(b.x*b.x+b.y*b.y+b.z*b.z)-(a.x*a.x+a.y*a.y+a.z*a.z));
        else if (state.currentFillMode==='zorder') {
            let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
            for(const c of candidates){if(c.x<x0)x0=c.x;if(c.x>x1)x1=c.x;if(c.y<y0)y0=c.y;if(c.y>y1)y1=c.y;if(c.z<z0)z0=c.z;if(c.z>z1)z1=c.z;}
            const scl=255/Math.max(x1-x0,y1-y0,z1-z0,1);
            for(const c of candidates){
                const ix=Math.round((c.x-x0)*scl),iy=Math.round((c.y-y0)*scl),iz=Math.round((c.z-z0)*scl);
                let m=0; for(let i=0;i<8;i++) m|=((ix>>i&1)<<(3*i))|((iy>>i&1)<<(3*i+1))|((iz>>i&1)<<(3*i+2));
                c._m=m;
            }
            candidates.sort((a,b)=>a._m-b._m);
        }
        else if (state.currentFillMode==='modular') {
            const M=6,bkts=Array.from({length:M},()=>[]);
            for(const c of candidates) bkts[Math.floor(((Math.atan2(c.y,c.x)+Math.PI)/(2*Math.PI))*M)%M].push(c);
            const d2=c=>c.x*c.x+c.y*c.y+c.z*c.z;
            for(const b of bkts) b.sort((a,b)=>d2(a)-d2(b));
            candidates=[];
            const ml=Math.max(...bkts.map(b=>b.length));
            for(let k=0;k<ml;k++) for(let r=0;r<M;r++) if(k<bkts[r].length) candidates.push(bkts[r][k]);
        }

        const cap = Math.min(candidates.length, state.MAX_POINTS);
        const flat = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i++) {
            const c = candidates[i];
            flat[i*3] = c.x; flat[i*3+1] = c.y; flat[i*3+2] = c.z;
        }
        _candidateCacheKey = cacheKey;
        _candidateCacheFlat = flat;
        _candidateCacheLen = cap;
        candidates = null;
    }

    const baseLim = Math.min(Math.max(state.activePointCount, state._maxRenderedCount), _candidateCacheLen);
    const flat = _candidateCacheFlat;
    const s = state.currentSpacing;
    for (let i = 0; i < baseLim * 3; i++) {
        state.baseTargetPositions[i] = flat[i] * s;
    }
    for (let i = baseLim * 3; i < Math.max(state.activePointCount, state._maxRenderedCount) * 3; i++) {
        state.baseTargetPositions[i] = 0;
    }
}

export function applyPositionOverlays() {
    const limit = Math.max(state.activePointCount, state._maxRenderedCount);
    for (let i = 0; i < limit; i++) {
        state.targetPositions[i * 3]     = state.baseTargetPositions[i * 3];
        state.targetPositions[i * 3 + 1] = state.baseTargetPositions[i * 3 + 1];
        state.targetPositions[i * 3 + 2] = state.baseTargetPositions[i * 3 + 2] + state.zetaOffsets[i] + state.ntlOffsets[i];
    }
    state.lerpActive = true;
}
