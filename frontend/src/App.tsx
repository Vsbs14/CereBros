import {useCallback, useEffect, useRef, useState} from 'react';
import {Activity, AudioLines, Users, History, Settings, LayoutDashboard, Headphones, FlaskConical, RefreshCw, Radio, ShieldCheck, ChevronRight} from 'lucide-react';
import {EEGChart, ERPChart, type EEGSample} from './Charts';
import {API_BASE_URL, fetchContract, inspectCapabilities} from './api';
import {api, downloadUrl, eegSamples, erpData, websocketUrl, type Analysis, type Comparison, type Device, type EEGMessage, type Session, type Student, type Source} from './client';
import {createSyntheticToneDemo, prepareAudioUpload, type PreparedAudioAsset} from './audio';
import {runExperiment} from './experiment';

const pages=['Dashboard','Sound Recognition','Live EEG','Students','Session History','Settings'] as const;
const icons=[LayoutDashboard,AudioLines,Activity,Users,History,Settings];
function Card({title,children,action}:{title:string;children:React.ReactNode;action?:React.ReactNode}){return <section className="card"><div className="card-heading"><h2>{title}</h2>{action}</div>{children}</section>}
function Empty({children}:{children:React.ReactNode}){return <div className="empty"><Activity size={28}/><p>{children}</p></div>}
const unavailable='Unavailable';

export default function App(){
  const [page,setPage]=useState<typeof pages[number]>('Dashboard');
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[connection,setConnection]=useState('Checking backend…'),[error,setError]=useState('');
  const [device,setDevice]=useState<Device|null>(null),[students,setStudents]=useState<Student[]>([]),[studentId,setStudentId]=useState(''),[name,setName]=useState('');
  const [sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState<Session|null>(null),[result,setResult]=useState<Analysis|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[comparison,setComparison]=useState<Comparison|null>(null),[slot,setSlot]=useState(0);
  const [samples,setSamples]=useState<EEGSample[]>([]),[paused,setPaused]=useState(false),[stream,setStream]=useState('No stream');
  const [liveSource,setLiveSource]=useState<Source|undefined>(undefined);
  const [source,setSource]=useState<Source>('simulation'),[port,setPort]=useState(''),[labels,setLabels]=useState('CH1,CH2,CH3,CH4,CH5,CH6,CH7,CH8'),[reference,setReference]=useState('Unspecified'),[channels,setChannels]=useState('1,2,3,4,5,6,7,8');
  const [baseline,setBaseline]=useState(-200),[endpoint,setEndpoint]=useState(800),[windowStart,setWindowStart]=useState(300),[windowEnd,setWindowEnd]=useState(600);
  const [trials,setTrials]=useState(120),[probability,setProbability]=useState(.2),[interval,setIntervalSeconds]=useState(1.5),[pair,setPair]=useState('tone-demo');
  const [headphones,setHeadphones]=useState(false),[audioReady,setAudioReady]=useState(false),[standard,setStandard]=useState<PreparedAudioAsset|null>(null),[deviant,setDeviant]=useState<PreparedAudioAsset|null>(null);
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(0),[apiDraft,setApiDraft]=useState(API_BASE_URL);
  const ctx=useRef<AudioContext|null>(null),controller=useRef<AbortController|null>(null),origin=useRef<number|null>(null),pauseRef=useRef(false),runningRef=useRef(false),previewRef=useRef<AudioBufferSourceNode|null>(null);
  const active=session?.status==='recording'||Boolean(device?.active_session_id);

  const refresh=useCallback(async()=>{
    const [d,s,h]=await Promise.all([api.device(),api.students(),api.sessions()]);
    setDevice(d);setStudents(s);setSessions(h);setStudentId(current=>current||s[0]?.id||'');
    if(d.active_session_id){const current=await api.session(d.active_session_id);setSession(current)}
  },[]);
  async function check(){
    setBusy(true);setError('');
    try{
      const contract=await fetchContract({signal:AbortSignal.timeout(5000)});
      const requirements=[{name:'students',path:'/api/students',method:'get' as const},{name:'session',path:'/api/sessions',method:'post' as const},{name:'events',path:'/api/sessions/{session_id}/events',method:'post' as const}];
      const unsupported=inspectCapabilities(contract,requirements).filter(c=>c.status!=='verified');
      if(unsupported.length)throw new Error(unsupported.map(c=>c.reason).join(' '));
      await refresh();setReady(true);setConnection('Backend connected');
    }catch(e){setReady(false);setConnection(`Backend unavailable · ${String(e)}`)}finally{setBusy(false)}
  }
  useEffect(()=>{void check();return()=>{controller.current?.abort(new Error('Workspace closed'));previewRef.current?.stop();void ctx.current?.close()}},[]);
  useEffect(()=>{pauseRef.current=paused},[paused]);
  useEffect(()=>{runningRef.current=running},[running]);
  useEffect(()=>{
    if(!ready)return;
    let disposed=false;let socket:WebSocket;let retry:ReturnType<typeof setTimeout>;let lastMessage=Date.now();
    const connect=()=>{
      socket=new WebSocket(websocketUrl());
      socket.onopen=()=>{lastMessage=Date.now();setStream('Connected · waiting for EEG')};
      socket.onmessage=event=>{
        lastMessage=Date.now();
        try{
          const message=JSON.parse(event.data);
          if(message.type==='status'){
            setDevice(message as Device);
            if(!message.connected&&runningRef.current)controller.current?.abort(new Error(message.error||'EEG device disconnected'));
          }else if(message.type==='eeg'){
            const batch=message as EEGMessage;
            if(batch.units!=='microvolts'||!batch.timestamps.length||batch.samples.length!==batch.timestamps.length)throw new Error('Invalid EEG batch');
            origin.current ??= batch.timestamps[0];setLiveSource(batch.source);
            setStream(`${batch.source.toUpperCase()} · ${batch.sampling_rate} Hz`);
            if(!pauseRef.current){const chunk=eegSamples(batch,origin.current);setSamples(previous=>{const combined=[...previous,...chunk];return combined.filter(s=>s.time_s>=chunk[chunk.length-1].time_s-10).slice(-5000)})}
          }
        }catch(e){setError(`Stream error: ${String(e)}`);controller.current?.abort(e)}
      };
      socket.onclose=()=>{if(disposed)return;setStream('Stream disconnected');controller.current?.abort(new Error('EEG stream disconnected'));retry=setTimeout(connect,2000)};
      socket.onerror=()=>socket.close();
    };
    connect();
    const watchdog=setInterval(()=>{if(Date.now()-lastMessage>6000&&runningRef.current)controller.current?.abort(new Error('EEG stream heartbeat lost'))},1000);
    return()=>{disposed=true;clearTimeout(retry);clearInterval(watchdog);socket?.close()};
  },[ready]);
  useEffect(()=>{
    if(!session)return;
    let alive=true;let polling=false;
    const poll=async()=>{if(polling)return;polling=true;try{const value=await api.analysis(session.id);if(alive)setResult(value)}catch(e){if(alive)setError(String(e))}finally{polling=false}};
    void poll();const timer=setInterval(()=>{if(session.status==='recording')void poll()},3000);
    return()=>{alive=false;clearInterval(timer)};
  },[session?.id,session?.status]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden){previewRef.current?.stop();controller.current?.abort(new Error('Experiment tab was hidden'))}};
    const unload=(event:BeforeUnloadEvent)=>{if(runningRef.current){event.preventDefault();event.returnValue=''}};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('beforeunload',unload);
    return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('beforeunload',unload)};
  },[]);
  async function action(task:()=>Promise<void>){setBusy(true);setError('');try{await task()}catch(e){setError(String(e))}finally{setBusy(false)}}
  async function connectDevice(){await action(async()=>{
    const d=await api.connect({source,serial_port:port,electrode_labels:labels.split(',').map(s=>s.trim()),electrode_reference:reference});
    origin.current=null;setSamples([]);setDevice(d);
  })}
  async function enableAudio(){await action(async()=>{
    ctx.current ??= new AudioContext();await ctx.current.resume();
    if(typeof ctx.current.getOutputTimestamp!=='function')throw new Error('This browser cannot estimate audio output timing');
    setAudioReady(ctx.current.state==='running');
  })}
  async function upload(file:File|undefined,kind:'standard'|'deviant'){
    if(!file)return;await action(async()=>{ctx.current ??= new AudioContext();const asset=await prepareAudioUpload(file,ctx.current);(kind==='standard'?setStandard:setDeviant)(asset)})
  }
  async function preview(kind:'standard'|'deviant'){
    await action(async()=>{
      if(!ctx.current||!headphones)throw new Error('Enable browser audio and confirm headphones first');
      await ctx.current.resume();previewRef.current?.stop();
      const buffer=pair==='tone-demo'?createSyntheticToneDemo(ctx.current,{frequencyHz:kind==='standard'?1000:1500}):(kind==='standard'?standard:deviant);
      if(!buffer)throw new Error(`Upload the ${kind} recording first`);
      const node=ctx.current.createBufferSource();node.buffer=buffer.buffer;node.connect(ctx.current.destination);node.onended=()=>{node.disconnect();if(previewRef.current===node)previewRef.current=null};previewRef.current=node;node.start();
    });
  }
  async function start(){
    setError('');let created:Session|null=null;
    try{
      if(!ctx.current||!audioReady||!headphones||!device?.connected)throw new Error('Connect EEG and prepare headphones/audio first');
      await ctx.current.resume();previewRef.current?.stop();
      const a=pair==='tone-demo'?createSyntheticToneDemo(ctx.current,{frequencyHz:1000}):standard;
      const b=pair==='tone-demo'?createSyntheticToneDemo(ctx.current,{frequencyHz:1500}):deviant;
      if(!a||!b)throw new Error('Upload both word recordings');
      if(a.id===b.id)throw new Error('Standard and deviant must be different audio files');
      if(Math.max(a.buffer.duration,b.buffer.duration)>=interval)throw new Error('Sound duration must be shorter than the stimulus interval');
      const selectedChannels=channels.split(',').map(s=>Number(s.trim())-1);
      setRunning(true);runningRef.current=true;setProgress(0);setResult(null);setSlot(0);setComparison(null);
      controller.current=new AbortController();
      created=await api.start({student_id:studentId,sound_pair_id:pair,trials,deviant_probability:probability,interval_s:interval,
        stimulus_metadata:{standard_audio_id:a.id,deviant_audio_id:b.id,standard_name:a.displayName,deviant_name:b.displayName},
        analysis:{channel_indices:selectedChannels,epoch_start_ms:baseline,baseline_start_ms:baseline,epoch_end_ms:endpoint,p300_start_ms:windowStart,p300_end_ms:windowEnd}});
      setSession(created);
      const completed=await runExperiment({session:created,context:ctx.current,standard:a,deviant:b,signal:controller.current.signal,onProgress:setProgress,onMarker:(trial,onset)=>setSession(current=>current?{...current,events:[...current.events,{...trial,onset_timestamp:onset}]}:current)});
      setSession(completed);setResult(completed.analysis);
    }catch(e){
      setError(String(e));if(created){try{const stopped=await api.session(created.id);setSession(stopped);setResult(stopped.analysis)}catch{/* Error stays visible; recording can be recovered using refresh. */}}
    }finally{setRunning(false);runningRef.current=false;controller.current=null;await refresh().catch(e=>setError(String(e)))}
  }
  async function stop(){
    if(running){controller.current?.abort(new Error('Stopped by user'));return}
    const id=device?.active_session_id||(session?.status==='recording'?session.id:null);
    if(id)await action(async()=>{const stopped=await api.stop(id,{interrupted:true,reason:'Stopped from workspace'});setSession(stopped);setResult(stopped.analysis);await refresh()});
  }
  async function view(id:string){await action(async()=>{const detail=await api.session(id);setSession(detail);setSlot(0);setComparison(null);setResult(await api.analysis(id));setPage('Session History')})}
  const chart=erpData(result,slot);
  const channelMap=Object.fromEntries((device?.channel_labels??[]).map((label,i)=>[`CH${i+1}`,label]));
  const markers=(session?.events??[]).filter(e=>!e.canceled).map(e=>({time_s:e.onset_timestamp-(origin.current??0),label:`Trial ${e.trial_index+1} · ${e.condition}`,kind:e.condition as 'standard'|'deviant'}));
  const plots=<div className="plot-grid"><Card title="Continuous EEG" action={<span className="badge neutral">{stream}</span>}><EEGChart samples={samples} channelMap={channelMap} markers={markers} source={liveSource}/></Card><Card title="Stimulus-locked ERP" action={<span className="badge neutral">{result?.quality.replaceAll('_',' ')??'Insufficient data'}</span>}>
    {result&&<label>ERP electrode<select value={slot} onChange={e=>setSlot(Number(e.target.value))}>{result.channel_labels.map((label,i)=><option key={i} value={i}>{label}</option>)}</select></label>}
    <ERPChart data={chart} baselineWindowMs={[result?.config.baseline_start_ms??baseline,0]} p300WindowMs={[result?.config.p300_start_ms??windowStart,result?.config.p300_end_ms??windowEnd]}/>
    {result&&<><p className="muted">Accepted standard {result.counts.accepted.standard} · deviant {result.counts.accepted.deviant} · rejected {result.counts.rejected} · pending {result.counts.pending}</p>{result.warnings.map(w=><p className="muted" key={w}>{w}</p>)}</>}
  </Card></div>;
  const studentSelect=<label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)} disabled={!ready||running||active}><option value="">Select a student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>;
  const history=<div className="table-scroll"><table><thead><tr><th>Compare</th><th>Session</th><th>Student</th><th>Source</th><th>Status</th></tr></thead><tbody>{sessions.map(s=><tr key={s.id}><td><input aria-label={`Compare session ${s.id}`} type="checkbox" checked={selected.includes(s.id)} disabled={s.status==='recording'} onChange={e=>setSelected(current=>e.target.checked?[...current,s.id]:current.filter(id=>id!==s.id))}/></td><td><button className="text-button" disabled={running||busy} onClick={()=>void view(s.id)}>{new Date(s.started_at*1000).toLocaleString()}</button></td><td>{students.find(student=>student.id===s.student_id)?.name??s.student_id}</td><td>{s.source.toUpperCase()}</td><td>{s.status}</td></tr>)}</tbody></table>{!sessions.length&&<Empty>{ready?'No sessions yet.':'Connect to the backend to load recorded sessions.'}</Empty>}</div>;

  return <div className="app"><a className="skip-link" href="#main">Skip to content</a><aside className="sidebar"><a className="brand" href="#dashboard" onClick={()=>setPage('Dashboard')}><span className="brand-icon"><AudioLines/></span><span>Neuro<span className="teal">Lingo</span><small>RESEARCH WORKSPACE</small></span></a><div className="nav-label">WORKSPACE</div><nav aria-label="Main navigation">{pages.map((p,i)=>{const Icon=icons[i];return <button className={page===p?'nav active':'nav'} key={p} onClick={()=>setPage(p)} aria-current={page===p?'page':undefined}><Icon size={19}/>{p}</button>})}</nav><div className="sidebar-bottom"><FlaskConical/><strong>Research, with care.</strong><p>Exploratory measurements.<br/>Human interpretation.</p></div></aside><div className="main"><header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14}/>{page}</div><span className="badge">{device?.source?.toUpperCase()??'No source confirmed'}</span></header><main id="main"><div className="page-heading"><div><span className="eyebrow">LANGUAGE & NEURAL RESPONSE</span><h1>{page}</h1><p>Record stimulus timing. Explore averaged responses.</p></div><button className="secondary" disabled={busy||running} onClick={()=>void check()}><RefreshCw size={16}/>Check connection</button></div><div className="connection" role="status"><Radio size={18}/><div><strong>{connection}</strong><span>{API_BASE_URL} · {stream}</span></div></div>
    {error&&<p className="warning" role="alert">{error}</p>}
    {(active||running)&&<div className="connection"><strong>{session?.source.toUpperCase()} · Recording · {progress}/{session?.request.trials} sounds completed</strong><button disabled={busy} onClick={()=>void stop()}>Early stop</button><span>Keep this tab visible. Recording continues through the final epoch automatically.</span></div>}
    {page==='Dashboard'&&<><div className="stats"><div className="stat"><span>ACQUISITION SOURCE</span><strong>{device?.source?.toUpperCase()??'Not connected'}</strong><small>{device?.sampling_rate??'—'} Hz</small></div><div className="stat"><span>SELECTED STUDENT</span><strong>{students.find(s=>s.id===studentId)?.name??'No student selected'}</strong></div><div className="stat"><span>RECORDING STATE</span><strong>{session?.status??unavailable}</strong></div><div className="stat"><span>STIMULUS TIMING</span><strong>Uncalibrated</strong><small>Physical output latency unknown</small></div></div>{plots}<div className="lower-grid"><Card title="Recent sessions">{history}</Card><Card title="Begin a listening experiment"><Headphones/><p>Use headphones and silently count infrequent sounds.</p><button className="primary" onClick={()=>setPage('Sound Recognition')}>Set up experiment</button></Card></div></>}
    {page==='Sound Recognition'&&<><div className="lower-grid"><Card title="Experiment setup"><fieldset disabled={running||active||busy}>{studentSelect}<label>Stimulus set<select value={pair} onChange={e=>setPair(e.target.value)}><option value="tone-demo">Synthetic-tone oddball demo (not language recognition)</option><option value="caballo-cabello">Caballo / cabello · teacher-supplied recordings</option></select></label><div className="form-grid"><label>Trials<input type="number" min="20" max="500" value={trials} onChange={e=>setTrials(Number(e.target.value))}/></label><label>Deviant probability<input type="number" min="0.1" max="0.4" step="0.05" value={probability} onChange={e=>setProbability(Number(e.target.value))}/></label><label>Interval (s)<input type="number" min="1.1" step="0.1" value={interval} onChange={e=>setIntervalSeconds(Number(e.target.value))}/></label></div>{pair!=='tone-demo'&&(['standard','deviant'] as const).map(kind=><label key={kind}>{kind==='standard'?'Standard · caballo':'Deviant · cabello'} recording<input type="file" accept="audio/*" onChange={e=>void upload(e.target.files?.[0],kind)}/><small>{(kind==='standard'?standard:deviant)?.displayName??'No recording selected'}</small></label>)}<p className="muted">Stimulus order comes from the server. Audio identities are saved with the session. A recording lead-in and final epoch tail are automatic.</p></fieldset></Card><Card title="Attention & timing"><ol className="instructions"><li>Use headphones in a quiet environment.</li><li>Stay still and silently count deviants.</li><li>Keep this tab visible.</li></ol><label className="checkbox"><input type="checkbox" checked={headphones} disabled={running} onChange={e=>{setHeadphones(e.target.checked);if(!e.target.checked)previewRef.current?.stop()}}/>Headphones are connected</label><button disabled={!headphones||running||busy} onClick={()=>void enableAudio()}>{audioReady?'Audio context ready':'Enable browser audio'}</button><div className="demo-box"><button disabled={!audioReady||running||busy} onClick={()=>void preview('standard')}>Preview standard</button> <button disabled={!audioReady||running||busy} onClick={()=>void preview('deviant')}>Preview deviant</button></div><p className="warning">Timing uncalibrated · browser estimates do not measure sound-at-ear onset. Peak latency is withheld.</p><button className="primary" disabled={!ready||!device?.connected||!studentId||!audioReady||!headphones||busy||running||active} onClick={()=>void start()}>Start experiment</button>{!device?.connected&&<p>Connect a source in Settings first.</p>}</Card></div>{plots}</>}
    {page==='Live EEG'&&<><Card title="Continuous raw EEG" action={<button onClick={()=>setPaused(!paused)}>{paused?'Resume display':'Pause display'}</button>}><p>{paused?'Display paused. Acquisition continues.':stream}</p><EEGChart samples={samples} channelMap={channelMap} markers={markers} source={liveSource}/></Card><Card title="Acquisition details"><p>{device?.sampling_rate??'—'} Hz · Reference: {device?.electrode_reference??'—'} · Signal quality: {device?.signal_quality??'unavailable'}</p><p>Software quality checks do not measure electrode contact impedance.</p></Card></>}
    {page==='Students'&&<div className="lower-grid"><Card title="Participants">{studentSelect}{students.length===0&&<Empty>No students yet. Create a participant to begin.</Empty>}{studentId&&<button disabled={busy||running} onClick={()=>{setSelected([]);setPage('Session History')}}>View session history</button>}</Card><Card title="New student"><form onSubmit={e=>{e.preventDefault();void action(async()=>{const s=await api.student(name.trim());setStudentId(s.id);setName('');await refresh()})}}><label>Display name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Enter participant name"/></label><button className="primary" disabled={!ready||busy||!name.trim()}>Create student</button></form></Card></div>}
    {page==='Session History'&&<><Card title="Saved sessions">{history}</Card><div className="lower-grid"><Card title="Before / after comparison"><button disabled={selected.length<2||selected.length>10||busy||running} onClick={()=>void action(async()=>setComparison(await api.compare(selected)))}>Compare selected sessions</button>{comparison&&<><p>{comparison.compatible?'Compatible descriptive measurements':'Comparison has limitations'}</p>{comparison.warnings.map(w=><p className="warning" key={w}>{w}</p>)}{comparison.sessions.map(s=><div key={s.id}><strong>{s.source.toUpperCase()} · {s.id.slice(0,8)} · {s.quality}</strong>{s.metrics.filter(m=>m.condition==='deviant').map(m=><p key={m.channel_index}>{m.electrode} P300-window mean: {m.window_mean_uv===null?'Unavailable':`${m.window_mean_uv.toFixed(2)} µV`}</p>)}</div>)}</>}</Card><Card title="Session exports">{session?<><p>{session.source.toUpperCase()} · {session.id}</p>{session.status!=='recording'&&<><a className="secondary" href={downloadUrl(session.id,'export.csv')}>Export CSV</a> <a className="secondary" href={downloadUrl(session.id,'recording.npz')}>Download NPZ</a><button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(session,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${session.source}-${session.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Download metadata</button></>}{session.warnings.map(w=><p className="warning" key={w}>{w}</p>)}</>:<p>Select a session to review and export.</p>}</Card></div>{plots}{result&&<Card title="Trial audit"><div className="table-scroll"><table><thead><tr><th>Trial</th><th>Condition</th><th>Status</th><th>Reasons</th></tr></thead><tbody>{result.trial_quality.map(t=><tr key={t.trial_index}><td>{t.trial_index+1}</td><td>{t.condition}</td><td>{t.status}</td><td>{t.reasons.join(', ')||'—'}</td></tr>)}</tbody></table></div></Card>}</>}
    {page==='Settings'&&<><div className="lower-grid"><Card title="Acquisition source"><fieldset disabled={busy||running||active||device?.connected}><label>Requested source<select value={source} onChange={e=>setSource(e.target.value as Source)}><option value="simulation">SIMULATION · synthetic EEG</option><option value="hardware">LIVE HARDWARE · Knight Board</option></select></label><label>Serial port<input value={port} onChange={e=>setPort(e.target.value)} disabled={source==='simulation'} placeholder="/dev/ttyACM0 or COM3"/></label><label>Eight channel labels (comma separated)<input value={labels} onChange={e=>setLabels(e.target.value)}/></label><label>Electrode reference<input value={reference} onChange={e=>setReference(e.target.value)}/></label></fieldset><button className="primary" disabled={!ready||busy||running||active||device?.connected} onClick={()=>void connectDevice()}>Connect source</button> <button disabled={!ready||busy||running||!device?.connected} onClick={()=>void action(async()=>{setDevice(await api.disconnect());await refresh()})}>Disconnect</button><p className="muted">Sources never switch automatically. Hardware startup can take about 20 seconds. Physical hardware verification is pending.</p></Card><Card title="Analysis settings for next session"><fieldset disabled={running||active}><label>EEG channels to analyze (1–8, comma separated)<input value={channels} onChange={e=>setChannels(e.target.value)}/></label><p className="muted">Select only physically connected EEG electrodes. Full-rate recordings keep every acquired channel.</p><div className="form-grid"><label>Baseline / epoch start (ms)<input type="number" value={baseline} onChange={e=>setBaseline(Number(e.target.value))}/></label><label>Epoch endpoint (ms)<input type="number" value={endpoint} onChange={e=>setEndpoint(Number(e.target.value))}/></label><label>P300 start (ms)<input type="number" value={windowStart} onChange={e=>setWindowStart(Number(e.target.value))}/></label><label>P300 end (ms)<input type="number" value={windowEnd} onChange={e=>setWindowEnd(Number(e.target.value))}/></label></div></fieldset><p>Settings are submitted and validated when starting the next session. Saved results retain their original settings.</p></Card></div><Card title="Backend address"><form onSubmit={e=>{e.preventDefault();try{const url=new URL(apiDraft);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP(S) address without credentials');localStorage.setItem('neurolingo-api-url',url.origin);window.location.reload()}catch(err){setError(String(err))}}}><label>API server URL<input type="url" required value={apiDraft} onChange={e=>setApiDraft(e.target.value)}/></label><button disabled={running||active}>Save address and reconnect</button></form><p>Local default: http://127.0.0.1:8000. Pages hosts only the frontend; the backend must be running separately. Translation remains unavailable; exploratory MMN/N400 protocols are configured through the API.</p></Card></>}
    <footer><ShieldCheck size={17}/><p>Exploratory ERP measurement. Responses depend on attention, signal quality, experimental design, and electrode placement. EEG alone cannot establish conscious recognition or successful discrimination. Session changes are descriptive, not proof of learning.</p></footer>
  </main></div></div>;
}
