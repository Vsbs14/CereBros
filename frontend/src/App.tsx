import {useCallback, useEffect, useRef, useState} from 'react';
import {Activity, AudioLines, Users, History, Settings, LayoutDashboard, Headphones, BookOpen, ArrowRight, RefreshCw, ShieldCheck, ChevronRight, Sun, Moon, UserRound, Radio, Waves, SlidersHorizontal} from 'lucide-react';
import {EEGChart, ERPChart, type EEGSample} from './Charts';
import {API_BASE_URL, fetchContract, inspectCapabilities} from './api';
import {api, downloadUrl, eegSamples, erpData, websocketUrl, type Analysis, type Comparison, type Device, type EEGMessage, type Session, type SignalCheck, type Student, type Source} from './client';
import {DisplayFilter} from './displayFilter';
import {createSyntheticToneDemo, prepareAudioUpload, type PreparedAudioAsset} from './audio';
import {runExperiment} from './experiment';

import {ElectrodeMap, LinkCard, SessionDiagram, SoundPairCard, resources, soundPairs} from './Guides';
import {DemoPractice, DemoProgress, StudentChips} from './Simple';
import {demoOptions} from './demo';

const pages=['How It Works','Dashboard','Sound Recognition','Live EEG','Students','Session History','Settings'] as const;
const icons=[BookOpen,LayoutDashboard,AudioLines,Activity,Users,History,Settings];
function Card({title,children,action}:{title:string;children:React.ReactNode;action?:React.ReactNode}){return <section className="card"><div className="card-heading"><h2>{title}</h2>{action}</div>{children}</section>}
function Empty({children}:{children:React.ReactNode}){return <div className="empty"><Activity size={28}/><p>{children}</p></div>}
const intros:Record<typeof pages[number],string>={
  'How It Works':'What happens during a session, which sound pairs are planned, where the electrodes go, and what the charts can and cannot show.',
  'Dashboard':'Set up a session, check the connection, and watch the response come in.',
  'Sound Recognition':'Configure the oddball experiment, prepare audio, and start recording.',
  'Live EEG':'Inspect the continuous signal from every active channel.',
  'Students':'Manage who takes part in listening sessions.',
  'Session History':'Review saved sessions, compare them descriptively, and export recordings.',
  'Settings':'Choose the acquisition source, channels, analysis windows, and backend address.',
};
/** Title Case for backend enum values such as "insufficient_data" or "completed". */
const titleCase=(value:string)=>value.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const sourceLabel=(value?:Source|null)=>value==='hardware'?'Live Hardware':value==='simulation'?'Simulation':'No Source';
type Theme='light'|'dark';
const THEME_KEY='neurolingo-theme';
function storedTheme():Theme|null{try{const value=localStorage.getItem(THEME_KEY);return value==='light'||value==='dark'?value:null}catch{return null}}
function systemTheme():Theme{return typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}

const simpleTabs=['Practice','Progress'] as const;

export default function App({initialPage='Dashboard',initialView='simple'}:{initialPage?:typeof pages[number];initialView?:'simple'|'teacher'}={}){
  const [page,setPage]=useState<typeof pages[number]>(initialPage);
  const [mode,setMode]=useState(initialView),[demo]=useState(()=>demoOptions());
  const [tab,setTab]=useState<typeof simpleTabs[number]>(demo.step==='progress'?'Progress':'Practice');
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
  const [displayFiltered,setDisplayFiltered]=useState(true),[chartScale,setChartScale]=useState<number|'auto'>('auto');
  const [signal,setSignal]=useState<SignalCheck|null>(null),[checking,setChecking]=useState(false),[override,setOverride]=useState(false);
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(0),[apiDraft,setApiDraft]=useState(API_BASE_URL);
  const ctx=useRef<AudioContext|null>(null),controller=useRef<AbortController|null>(null),origin=useRef<number|null>(null),pauseRef=useRef(false),runningRef=useRef(false),previewRef=useRef<AudioBufferSourceNode|null>(null);
  const filterRef=useRef<DisplayFilter|null>(null),filterOnRef=useRef(true);
  const active=session?.status==='recording'||Boolean(device?.active_session_id);
  const [theme,setTheme]=useState<Theme>(()=>{if(typeof document==='undefined')return 'light';const preset=document.documentElement.dataset.theme;/* index.html applies the theme before mount; reuse it so the two never disagree */return preset==='dark'||preset==='light'?preset:storedTheme()??systemTheme()});
  useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme},[theme]);
  // Follow the system setting until the user picks a theme explicitly.
  useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(prefers-color-scheme: dark)');const follow=()=>{if(!storedTheme())setTheme(query.matches?'dark':'light')};query.addEventListener('change',follow);return()=>query.removeEventListener('change',follow)},[]);
  function toggleTheme(){const next=theme==='dark'?'light':'dark';setTheme(next);try{localStorage.setItem(THEME_KEY,next)}catch{/* preference lasts for this visit only */}}

  const refresh=useCallback(async()=>{
    const [d,s,h]=await Promise.all([api.device(),api.students(),api.sessions()]);
    setDevice(d);if(d.connected&&d.active_channels?.length)setChannels(d.active_channels.join(','));setStudents(s);setSessions(h);setStudentId(current=>current||s[0]?.id||'');
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
  useEffect(()=>{filterOnRef.current=displayFiltered;filterRef.current=null;origin.current=null;setSamples([])},[displayFiltered]);
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
            let shown=batch;
            if(filterOnRef.current){
              if(!filterRef.current)filterRef.current=new DisplayFilter(batch.sampling_rate);
              shown={...batch,samples:filterRef.current.process(batch.timestamps,batch.samples) as number[][]};
            }
            if(!pauseRef.current){const chunk=eegSamples(shown,origin.current);setSamples(previous=>{const combined=[...previous,...chunk];return combined.filter(s=>s.time_s>=chunk[chunk.length-1].time_s-10).slice(-5000)})}
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
  const activeChannels=[...new Set(channels.split(',').map(c=>Number(c.trim())).filter(c=>Number.isInteger(c)&&c>=1&&c<=8))].sort((a,b)=>a-b).map(c=>c-1);
  const shownChannels=activeChannels.map(c=>`CH${c+1}`);
  const checkedChannelsMatch=signal?.channels.map(c=>c.channel-1).join(',')===activeChannels.join(',');
  const checkFresh=Boolean(checkedChannelsMatch&&signal?.checked_at&&Date.now()/1000-signal.checked_at<600&&signal.source===device?.source);
  const signalOk=device?.source!=='hardware'||(checkFresh&&Boolean(signal?.ready))||override;
  async function runSignalCheck(){setChecking(true);setError('');try{setSignal(await api.signalCheck(activeChannels));setOverride(false)}catch(e){setError(String(e))}finally{setChecking(false)}}
  async function action(task:()=>Promise<void>){setBusy(true);setError('');try{await task()}catch(e){setError(String(e))}finally{setBusy(false)}}
  async function connectDevice(){await action(async()=>{
    const d=await api.connect({source,serial_port:port,electrode_labels:labels.split(',').map(s=>s.trim()),electrode_reference:reference,active_channels:activeChannels.map(c=>c+1)});
    origin.current=null;filterRef.current=null;setSamples([]);setSignal(null);setOverride(false);setDevice(d);
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
      if(!signalOk)throw new Error('Run a passing signal check before starting hardware acquisition');
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
  async function view(id:string){await action(async()=>{const detail=await api.session(id);setSession(detail);setSlot(0);setComparison(null);setResult(await api.analysis(id));setPage('Session History');setMode('teacher')})}
  const chart=erpData(result,slot);
  const channelMap=Object.fromEntries((device?.channel_labels??[]).map((label,i)=>[`CH${i+1}`,label]));
  const markers=(session?.events??[]).filter(e=>!e.canceled).map(e=>({time_s:e.onset_timestamp-(origin.current??0),label:`Trial ${e.trial_index+1} · ${e.condition}`,kind:e.condition as 'standard'|'deviant'}));

  const student=students.find(s=>s.id===studentId);
  const link=busy&&!ready?{label:'Checking Connection…',short:'Checking…',tone:'idle'}:!ready?{label:'EEG Not Connected',short:'Not Connected',tone:'alert'}:device?.connected?{label:`${sourceLabel(device.source)} Connected`,short:'Connected',tone:'ok'}:{label:'Backend Connected · No Source',short:'No Source',tone:'pending'};
  const eegHint=!ready?'Start the backend, then reconnect to stream from the headset.':!device?.connected?'Connect a source in Settings to start streaming.':'Waiting for EEG from the stream…';
  const erpHint='Builds from accepted standard and deviant trials once a recording session starts.';
  const signalLabel=checking?'Checking…':signal?(checkFresh?titleCase(signal.overall):'Expired'):'Not Run';
  const signalTone=signal?.overall==='good'?'good':signal?.overall==='fair'?'neutral':signal?'warn':'neutral';
  const scaleOptions=<label>Scale<select value={String(chartScale)} onChange={e=>setChartScale(e.target.value==='auto'?'auto':Number(e.target.value))}><option value="auto">Auto</option>{[10,25,50,100,200,500,1000].map(v=><option key={v} value={v}>±{v} µV</option>)}</select></label>;
  const eegControlItems=<><label className="checkbox"><input type="checkbox" checked={displayFiltered} onChange={e=>setDisplayFiltered(e.target.checked)}/>Clean Display (1–40 Hz, Remove 50/60 Hz Hum)</label>{scaleOptions}</>;
  const eegControls=<div className="control-row">{eegControlItems}</div>;
  const eegChart=<EEGChart samples={samples} channels={shownChannels} channelMap={channelMap} markers={markers} source={liveSource?sourceLabel(liveSource):undefined} scaleUv={chartScale} emptyDetail={eegHint} subtitle={displayFiltered?'Display Filter 1–40 Hz, 50/60 Hz Hum Removed · Recording Stays Raw':'Raw Signal · Offset Removed per Channel'}/>;
  const plots=<section aria-labelledby="evidence-title">
    <div className="section-heading"><h2 id="evidence-title">Listening Response</h2><span className="meta">{stream}</span></div>
    <div className="plot-grid">
      <div className="signal-panel">{eegControls}{eegChart}</div>
      <div className="signal-panel">
        <div className="control-row">{result?<label>ERP Electrode<select value={slot} onChange={e=>setSlot(Number(e.target.value))}>{result.channel_labels.map((label,i)=><option key={i} value={i}>{label}</option>)}</select></label>:<span className="meta">Stimulus-Locked Average</span>}<span className="badge">{result?titleCase(result.quality):'Insufficient Data'}</span></div>
        <ERPChart data={chart} baselineWindowMs={[result?.config.baseline_start_ms??baseline,0]} p300WindowMs={[result?.config.p300_start_ms??windowStart,result?.config.p300_end_ms??windowEnd]} emptyDetail={erpHint}/>
        {result&&<><p className="muted">Accepted standard {result.counts.accepted.standard} · deviant {result.counts.accepted.deviant} · rejected {result.counts.rejected} · pending {result.counts.pending}</p>{result.warnings.map(w=><p className="muted" key={w}>{w}</p>)}</>}
      </div>
    </div>
  </section>;
  const signalCard=<Card title="Signal Check" action={<span className={`badge ${signalTone}`}>{signalLabel}</span>}>
    <p className="muted">Records 5 seconds from channels {activeChannels.map(c=>c+1).join(', ')||'none'} and predicts how many trials would pass the artifact check. Sit still, eyes open, relaxed jaw. Run it right before every experiment.</p>
    <button className="primary" disabled={!ready||!device?.connected||checking||running||!activeChannels.length} onClick={()=>void runSignalCheck()}>{checking?'Checking…':'Run Signal Check'}</button>
    {signal&&<>{signal.channels.length>0&&<div className="table-scroll"><table><thead><tr><th>Channel</th><th>Status</th><th>Usable Windows</th><th>EEG RMS</th><th>Hum Before Filtering</th><th>After Notch: Peak-to-Peak</th><th>Notes</th></tr></thead><tbody>{signal.channels.map(c=><tr key={c.channel}><td>{c.label}</td><td><span className={`badge ${c.status==='good'?'good':c.status==='fair'?'neutral':'warn'}`}>{titleCase(c.status)}</span></td><td>{Math.round(c.predicted_acceptance*100)}%</td><td>{c.eeg_rms_uv.toFixed(1)} µV</td><td>{c.line_noise_rms_uv>=1000?`${(c.line_noise_rms_uv/1000).toFixed(0)}k`:c.line_noise_rms_uv.toFixed(1)} µV</td><td>{c.post_notch_peak_to_peak_uv?.toFixed(1)??'—'} µV</td><td>{c.problems.join(' ')||'OK'} {Object.entries(c.rejection_reasons??{}).map(([reason,count])=>`${reason}: ${count} windows`).join('; ')}</td></tr>)}</tbody></table></div>}
    {signal.advice.map(a=><p className="warning" key={a}>{a}</p>)}{signal.ready&&<p>Signal looks usable. You can start the experiment.</p>}<p className="muted">{signal.note}</p></>}
  </Card>;
  const studentSelect=<label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)} disabled={!ready||running||active}><option value="">Select a Student</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>;
  const history=<div className="table-scroll"><table><thead><tr><th>Compare</th><th>Session</th><th>Student</th><th>Source</th><th>Status</th></tr></thead><tbody>{sessions.map(s=><tr key={s.id}><td><input aria-label={`Compare session ${s.id}`} type="checkbox" checked={selected.includes(s.id)} disabled={s.status==='recording'} onChange={e=>setSelected(current=>e.target.checked?[...current,s.id]:current.filter(id=>id!==s.id))}/></td><td><button className="text-button" disabled={running||busy} onClick={()=>void view(s.id)}>{new Date(s.started_at*1000).toLocaleString()}</button></td><td>{students.find(student=>student.id===s.student_id)?.name??s.student_id}</td><td>{sourceLabel(s.source)}</td><td>{titleCase(s.status)}</td></tr>)}</tbody></table>{!sessions.length&&<Empty>{ready?'No sessions yet.':'Connect to the backend to load recorded sessions.'}</Empty>}</div>;
  const steps=[
    {icon:UserRound,title:'Choose a Student',description:'Pick who will listen, or add a new student.',state:student?student.name:ready?(students.length?'None Selected':'No Students Yet'):'Needs Backend Connection',done:Boolean(student),action:'Open Students',to:'Students' as const},
    {icon:Radio,title:'Connect a Source',description:'Choose simulation or the Knight Board and connect it.',state:device?.connected?`${sourceLabel(device.source)} Connected`:ready?'Not Connected':'Backend Offline',done:Boolean(device?.connected),alert:!ready&&!busy,action:'Open Settings',to:'Settings' as const},
    {icon:Waves,title:'Check the Signal',description:'Seat the electrodes over Cz and Pz, then run a 5-second signal check.',state:device?.source==='simulation'?'Not Needed for Simulation':checkFresh&&signal?.ready?'Signal Usable':signal?'Needs Attention':'Not Run',done:device?.source==='simulation'||Boolean(checkFresh&&signal?.ready),action:'Run Signal Check',to:'Settings' as const},
    {icon:Headphones,title:'Start Listening',description:'Headphones on, enable audio, and start. The learner silently counts the odd sound.',state:running||active?'Recording…':'Ready When Steps Are Done',done:running||active,action:'Go to Experiment',to:'Sound Recognition' as const},
  ];
  const heading=<div className="page-heading"><div><h1>{page}</h1><p className="page-intro">{intros[page]}</p></div>{page==='Dashboard'&&<button className="primary" onClick={()=>setPage('Sound Recognition')}>Set Up Experiment <ArrowRight size={16}/></button>}</div>;

  const themeButton=<button className="icon-button" onClick={toggleTheme} aria-label={theme==='dark'?'Switch to Light Mode':'Switch to Dark Mode'} title={theme==='dark'?'Switch to Light Mode':'Switch to Dark Mode'}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button>;
  const simpleLink=demo.enabled?{label:'Headset connected',tone:'ok'}:link;
  const studentSessions=sessions.filter(s=>!studentId||s.student_id===studentId);
  const canStart=ready&&device?.connected&&studentId&&audioReady&&headphones&&!busy&&!running&&!active&&signalOk;
  const realPractice=<div className="simple-page">
    {error&&<p className="warning" role="alert">{error}</p>}
    <section className="panel">
      <h2>Who's listening today?</h2>
      {students.length?<StudentChips students={students} value={studentId} onChange={setStudentId} disabled={running||active}/>:<p className="muted">{ready?'No students yet. Add one below.':'Waiting for the NeuroLingo server…'}</p>}
      <form className="inline-form" onSubmit={e=>{e.preventDefault();void action(async()=>{const s=await api.student(name.trim());setStudentId(s.id);setName('');await refresh()})}}><input aria-label="New student name" maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Add a student"/><button className="secondary" disabled={!ready||busy||!name.trim()}>Add</button></form>
    </section>
    <section className="panel setup-panel">
      <div className="setup-head"><div><p className="eyebrow">{student?.name??'No student'} · Listening</p><h2>{running||active?'Listening…':canStart?'Ready to start':'Get ready'}</h2></div>
        <label className="lesson-select">Lesson<select value={pair} onChange={e=>setPair(e.target.value)} disabled={running||active}><option value="tone-demo">Tone warm-up</option><option value="caballo-cabello">caballo / cabello</option></select></label></div>
      <ol className="ready-list">
        <li data-done={Boolean(device?.connected)}><span className="ready-dot" aria-hidden="true"/><span>Headset</span><span className="ready-state">{device?.connected?`${sourceLabel(device.source)} connected`:'Not connected'}</span>{!device?.connected&&<button className="secondary compact" disabled={!ready||busy} onClick={()=>void connectDevice()}>Connect</button>}</li>
        <li data-done={Boolean(device?.connected)&&(device?.source!=='hardware'||Boolean(checkFresh&&signal?.ready))}><span className="ready-dot" aria-hidden="true"/><span>Signal</span><span className="ready-state">{device?.source==='hardware'?signalLabel:'Not needed'}</span>{device?.source==='hardware'&&<button className="secondary compact" disabled={!device.connected||checking||running} onClick={()=>void runSignalCheck()}>{checking?'Checking…':'Check signal'}</button>}</li>
        <li data-done={headphones&&audioReady}><span className="ready-dot" aria-hidden="true"/><span>Headphones</span><label className="checkbox ready-state"><input type="checkbox" checked={headphones} disabled={running} onChange={e=>setHeadphones(e.target.checked)}/>Connected</label>{!audioReady&&<button className="secondary compact" disabled={!headphones||busy} onClick={()=>void enableAudio()}>Turn on sound</button>}</li>
        {pair!=='tone-demo'&&<li data-done={Boolean(standard&&deviant)}><span className="ready-dot" aria-hidden="true"/><span>Recordings</span><span className="ready-state">{standard&&deviant?'Added':'Add both words in Teacher view'}</span><button className="secondary compact" onClick={()=>{setPage('Sound Recognition');setMode('teacher')}}>Open</button></li>}
      </ol>
      {(running||active)&&<div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={session?.request.trials??trials} aria-valuenow={progress}><span style={{width:`${(progress/(session?.request.trials??trials))*100}%`}}/></div>}
      {device?.connected&&<div className="trace-frame">{eegChart}</div>}
      <div className="setup-actions">{running||active?<button className="big-button secondary" disabled={busy} onClick={()=>void stop()}>Stop</button>:<button className="big-button primary" disabled={!canStart} onClick={()=>void start()}>Start <ArrowRight size={20}/></button>}</div>
    </section>
    {result&&!running&&!active&&<section className="panel"><h2>Last session</h2><p className="lead">{result.counts.accepted.standard+result.counts.accepted.deviant} sounds measured · {titleCase(result.quality)}</p><p className="muted">Exploratory measurement. Responses depend on attention, signal quality and electrode placement.</p><button className="secondary" onClick={()=>{setPage('Session History');setMode('teacher')}}>Open full results <ArrowRight size={14}/></button></section>}
  </div>;
  const realProgress=<div className="simple-page">
    <div className="progress-head"><div><p className="eyebrow">{student?.name??'All students'}</p><h2 className="page-title">Progress</h2></div></div>
    <section className="panel">{studentSessions.length?<ul className="session-list">{studentSessions.map(s=><li key={s.id}><span className="when">{new Date(s.started_at*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><strong>{s.request.sound_pair_id==='tone-demo'?'Tone warm-up':s.request.sound_pair_id.replace('-',' / ')}</strong><span className="pill">{titleCase(s.status)}</span><button className="text-button" onClick={()=>void view(s.id)}>Details <ArrowRight size={14}/></button></li>)}</ul>:<p className="muted">{ready?'No sessions yet. Finished sessions show up here.':'Waiting for the NeuroLingo server…'}</p>}</section>
  </div>;
  if(mode==='simple')return <div className="simple-app">
    <header className="simple-bar">
      <button className="brand" onClick={()=>setTab('Practice')}><AudioLines size={22}/><span>NeuroLingo</span></button>
      <nav className="tabs" aria-label="Main navigation">{simpleTabs.map(t=><button key={t} className={tab===t?'tab active':'tab'} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{t}</button>)}</nav>
      <div className="bar-end">
        <span className="link-label" data-tone={simpleLink.tone}><span className="status-dot" aria-hidden="true"/><span role="status">{simpleLink.label}</span></span>
        <button className="secondary compact" onClick={()=>setMode('teacher')}><SlidersHorizontal size={15}/>Teacher View</button>
        {themeButton}
      </div>
    </header>
    <main id="main" className="simple-main">
      {tab==='Practice'?(demo.enabled?<DemoPractice options={demo} onShowProgress={()=>setTab('Progress')}/>:realPractice):(demo.enabled?<DemoProgress onPractice={()=>setTab('Practice')}/>:realProgress)}
    </main>
  </div>;

  return <div className="app"><a className="skip-link" href="#main">Skip to Content</a>
    <aside className="sidebar">
      <button className="brand" onClick={()=>setMode('simple')}><AudioLines size={24}/><span>NeuroLingo</span></button>
      <nav aria-label="Main navigation">{pages.map((p,i)=>{const Icon=icons[i];return <button className={page===p?'nav active':'nav'} key={p} onClick={()=>setPage(p)} aria-current={page===p?'page':undefined}><Icon size={18}/>{p}</button>})}</nav>
      <div className="sidebar-bottom">Powered by CereBros</div>
    </aside>
    <div className="main"><header className="topbar"><div className="breadcrumb">NeuroLingo <ChevronRight size={14}/><span>{page}</span></div>
      <div className="link-status" data-tone={link.tone}><span className="link-label"><span className="status-dot" aria-hidden="true"/><span role="status">{link.label}</span></span><span className="divider" aria-hidden="true"/><button className="text-button" disabled={busy||running} onClick={()=>void check()}><RefreshCw size={14}/>{busy&&!ready?'Checking…':'Reconnect'}</button><details><summary>Details</summary><p>{connection}<br/>{API_BASE_URL} · {stream}</p></details><button className="secondary compact" onClick={()=>setMode('simple')}>Simple View</button><button className="icon-button" onClick={toggleTheme} aria-label={theme==='dark'?'Switch to Light Mode':'Switch to Dark Mode'} title={theme==='dark'?'Switch to Light Mode':'Switch to Dark Mode'}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button></div>
    </header>
    <main id="main"><div className="page">{heading}
    {error&&<p className="warning" role="alert">{error}</p>}
    {(active||running)&&<div className="recording-banner"><span className="status-dot" aria-hidden="true"/><strong>{sourceLabel(session?.source)} · Recording · {progress}/{session?.request.trials} Sounds Completed</strong><span>Keep this tab visible. Recording continues through the final epoch automatically.</span><button disabled={busy} onClick={()=>void stop()}>Early Stop</button></div>}
    {page==='How It Works'&&<>
      <div className="split split-wide">
        <Card title="How a Session Works"><SessionDiagram baselineMs={baseline} windowMs={[windowStart,windowEnd]} epochEndMs={endpoint}/></Card>
        <Card title="Headset &amp; Electrodes">
          <div className="headset-guide"><ElectrodeMap/><div><p className="muted">The P300 is usually examined over central–parietal midline sites such as Cz and Pz.</p><ol className="checklist"><li>Enter electrode labels that match the Knight Board channels.</li><li>Check contact and reference before recording.</li><li>Ask the learner to stay still and relaxed.</li></ol><div className="button-row"><button className="secondary" onClick={()=>setPage('Settings')}>Open Settings</button><a className="text-button" href="https://docs.neuropawn.tech/headwear/" target="_blank" rel="noreferrer">Fitting Guide <ArrowRight size={14}/></a></div></div></div>
        </Card>
      </div>
      <section aria-labelledby="pairs-title"><div className="section-heading"><h2 id="pairs-title">Sound Pairs</h2><span className="meta">Proposed First-Language Packs, Not Diagnoses</span></div>
        <div className="card-grid">{soundPairs.map(pair=><SoundPairCard key={pair.id} pair={pair} onSelect={()=>setPage('Sound Recognition')}/>)}</div>
      </section>
      <div className="card-grid">
        <Card title="Continuous EEG"><p className="body-copy">The raw signal from every channel, in microvolts over seconds. Use it to check contact, movement, and noise while recording. A single visible spike is not a response to a sound.</p></Card>
        <Card title="Averaged ERP"><p className="body-copy">Epochs around each sound are averaged separately for standard and deviant sounds. The P300-window mean amplitude of the difference is the primary measure; it stays provisional until the session stops.</p></Card>
        <Card title="What It Can’t Tell You"><p className="body-copy">Responses depend on attention, signal quality, experimental design, and electrode placement. EEG alone cannot establish conscious recognition or successful discrimination, and changes between sessions are descriptive, not proof of learning.</p></Card>
      </div>
      <section aria-labelledby="resources-title"><div className="section-heading"><h2 id="resources-title">NeuroPawn Resources</h2><span className="meta">docs.neuropawn.tech</span></div>
        <div className="card-grid">{resources.map(r=><LinkCard key={r.href} {...r}/>)}</div>
      </section>
    </>}
    {page==='Dashboard'&&<>
      <section aria-labelledby="steps-title"><div className="section-heading"><h2 id="steps-title">Set Up a Session</h2></div>
        <ol className="step-cards">{steps.map((step,i)=>{const Icon=step.icon;return <li key={step.title} className="step-card">
          <div className="step-card-top"><span className="step-number">{i+1}</span><Icon size={20} aria-hidden="true"/></div>
          <h3>{step.title}</h3><p>{step.description}</p>
          <span className="step-state" data-tone={step.alert?'alert':step.done?'ok':undefined}>{step.state}</span>
          <button className="secondary" onClick={()=>setPage(step.to)}>{step.action} <ArrowRight size={14}/></button>
        </li>})}</ol>
      </section>
      <section aria-label="Session status" className="stat-grid">
        <div className="stat" data-tone={link.tone}><span className="meta">Acquisition Source</span><strong><span className="status-dot" aria-hidden="true"/>{device?.connected?sourceLabel(device.source):'Not Connected'}</strong><small>{device?.sampling_rate??'—'} Hz</small></div>
        <div className="stat"><span className="meta">Selected Student</span><strong>{student?.name??'No Student Selected'}</strong><small>{students.length} on record</small></div>
        <div className="stat"><span className="meta">Recording State</span><strong>{session?titleCase(session.status):'No Active Session'}</strong><small>{session?`${session.request.trials} trials planned`:'Start one from Sound Recognition'}</small></div>
        <div className="stat"><span className="meta">Stimulus Timing</span><strong>Uncalibrated</strong><small>Physical output latency unknown</small></div>
      </section>
      {plots}
      <section aria-labelledby="recent-title"><div className="section-heading"><h2 id="recent-title">Recent Sessions</h2><button className="text-button" onClick={()=>setPage('Session History')}>All Sessions <ArrowRight size={14}/></button></div>
        <div className="card">{history}</div>
      </section>
    </>}
    {page==='Sound Recognition'&&<><div className="split"><Card title="Experiment Setup"><fieldset disabled={running||active||busy}>{studentSelect}<label>Stimulus Set<select value={pair} onChange={e=>setPair(e.target.value)}><option value="tone-demo">Synthetic-Tone Oddball Demo (Not Language Recognition)</option><option value="caballo-cabello">Caballo / Cabello · Teacher-Supplied Recordings</option></select></label><div className="form-grid"><label>Trials<input type="number" min="20" max="500" value={trials} onChange={e=>setTrials(Number(e.target.value))}/></label><label>Deviant Probability<input type="number" min="0.1" max="0.4" step="0.05" value={probability} onChange={e=>setProbability(Number(e.target.value))}/></label><label className="span-full">Interval (s)<input type="number" min="1.1" step="0.1" value={interval} onChange={e=>setIntervalSeconds(Number(e.target.value))}/></label></div>{pair!=='tone-demo'&&(['standard','deviant'] as const).map(kind=><label key={kind}>{kind==='standard'?'Standard · Caballo':'Deviant · Cabello'} Recording<input type="file" accept="audio/*" onChange={e=>void upload(e.target.files?.[0],kind)}/><small>{(kind==='standard'?standard:deviant)?.displayName??'No recording selected'}</small></label>)}<p className="muted">Stimulus order comes from the server. Audio identities are saved with the session. A recording lead-in and final epoch tail are automatic.</p></fieldset></Card>
      <Card title="Before You Begin"><ol className="instructions"><li>Use headphones in a quiet environment.</li><li>Stay still and silently count deviants.</li><li>Keep this tab visible.</li></ol><label className="checkbox"><input type="checkbox" checked={headphones} disabled={running} onChange={e=>{setHeadphones(e.target.checked);if(!e.target.checked)previewRef.current?.stop()}}/>Headphones Are Connected</label><div className="button-row"><button className="secondary" disabled={!headphones||running||busy} onClick={()=>void enableAudio()}>{audioReady?'Audio Context Ready':'Enable Browser Audio'}</button><button disabled={!audioReady||running||busy} onClick={()=>void preview('standard')}>Preview Standard</button><button disabled={!audioReady||running||busy} onClick={()=>void preview('deviant')}>Preview Deviant</button></div><p className="warning">Timing uncalibrated · browser estimates do not measure sound-at-ear onset. Peak latency is withheld.</p>{device?.source==='hardware'&&!(checkFresh&&signal?.ready)&&<><p className="warning">Run a passing signal check (below) within the last 10 minutes before recording. Otherwise trials will likely all be rejected.</p><label className="checkbox"><input type="checkbox" checked={override} disabled={running} onChange={e=>setOverride(e.target.checked)}/>Start Anyway (Testing Only)</label></>}<button className="primary" disabled={!ready||!device?.connected||!studentId||!audioReady||!headphones||busy||running||active||!signalOk} onClick={()=>void start()}>Start Experiment</button>{!device?.connected&&<p className="muted">Connect a source in Settings first.</p>}</Card></div>{signalCard}{plots}</>}
    {page==='Live EEG'&&<><section className="signal-panel"><div className="control-row">{eegControlItems}<button className="secondary push-end" onClick={()=>setPaused(!paused)}>{paused?'Resume Display':'Pause Display'}</button></div><p className="muted">{paused?'Display paused. Acquisition continues.':stream}</p>{eegChart}</section>
      <Card title="Acquisition Details"><dl><dt>Source</dt><dd>{device?.connected?sourceLabel(device.source):'Not Connected'}</dd><dt>Sampling Rate</dt><dd>{device?.sampling_rate??'—'} Hz</dd><dt>Reference</dt><dd>{device?.electrode_reference??'—'}</dd><dt>Signal Quality</dt><dd>{titleCase(device?.signal_quality??'unavailable')}</dd><dt>Stream</dt><dd>{stream}</dd></dl><p className="muted">Software quality checks do not measure electrode contact impedance.</p></Card></>}
    {page==='Students'&&<div className="split"><Card title="Student List">{studentSelect}{students.length===0&&<Empty>{ready?'No students yet. Add one to begin.':'Connect to the backend to load students.'}</Empty>}{studentId&&<button className="secondary" disabled={busy||running} onClick={()=>{setSelected([]);setPage('Session History')}}>View Session History</button>}</Card><Card title="Add a Student"><form onSubmit={e=>{e.preventDefault();void action(async()=>{const s=await api.student(name.trim());setStudentId(s.id);setName('');await refresh()})}}><label>Display Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Enter student name"/></label><button className="primary" disabled={!ready||busy||!name.trim()}>Create Student</button></form></Card></div>}
    {page==='Session History'&&<><Card title="Saved Sessions">{history}</Card><div className="split"><Card title="Before / After Comparison"><button className="secondary" disabled={selected.length<2||selected.length>10||busy||running} onClick={()=>void action(async()=>setComparison(await api.compare(selected)))}>Compare Selected Sessions</button>{comparison&&<><p>{comparison.compatible?'Compatible descriptive measurements':'Comparison has limitations'}</p>{comparison.warnings.map(w=><p className="warning" key={w}>{w}</p>)}{comparison.sessions.map(s=><div key={s.id}><strong>{sourceLabel(s.source)} · {s.id.slice(0,8)} · {titleCase(s.quality)}</strong>{s.metrics.filter(m=>m.condition==='deviant').map(m=><p key={m.channel_index}>{m.electrode} P300-window mean: {m.window_mean_uv===null?'Unavailable':`${m.window_mean_uv.toFixed(2)} µV`}</p>)}</div>)}</>}{!comparison&&<p className="muted">Select two to ten sessions above for a descriptive comparison.</p>}</Card><Card title="Session Exports">{session?<><p>{sourceLabel(session.source)} · {session.id}</p>{session.status!=='recording'&&<div className="button-row"><a className="secondary button-link" href={downloadUrl(session.id,'export.csv')}>Export CSV</a><a className="secondary button-link" href={downloadUrl(session.id,'recording.npz')}>Download NPZ</a><button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(session,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${session.source}-${session.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Download Metadata</button></div>}{session.warnings.map(w=><p className="warning" key={w}>{w}</p>)}</>:<p className="muted">Select a session to review and export.</p>}</Card></div>{plots}{result&&<Card title="Trial Audit"><div className="table-scroll"><table><thead><tr><th>Trial</th><th>Condition</th><th>Status</th><th>Reasons</th></tr></thead><tbody>{result.trial_quality.map(t=><tr key={t.trial_index}><td>{t.trial_index+1}</td><td>{titleCase(t.condition)}</td><td>{titleCase(t.status)}</td><td>{t.reasons.join(', ')||'—'}</td></tr>)}</tbody></table></div></Card>}</>}
    {page==='Settings'&&<><div className="split"><Card title="Acquisition Source"><fieldset disabled={busy||running||active||device?.connected}><label>Requested Source<select value={source} onChange={e=>setSource(e.target.value as Source)}><option value="simulation">Simulation · Synthetic EEG</option><option value="hardware">Live Hardware · Knight Board</option></select></label><label>Serial Port<input value={port} onChange={e=>setPort(e.target.value)} disabled={source==='simulation'} placeholder="/dev/ttyACM0 or COM3"/></label><label>Eight Channel Labels (Comma Separated)<input value={labels} onChange={e=>setLabels(e.target.value)}/></label><label>Electrode Reference<input value={reference} onChange={e=>setReference(e.target.value)}/></label></fieldset><div className="button-row"><button className="primary" disabled={!ready||busy||running||active||device?.connected} onClick={()=>void connectDevice()}>Connect Source</button><button disabled={!ready||busy||running||!device?.connected} onClick={()=>void action(async()=>{setDevice(await api.disconnect());await refresh()})}>Disconnect</button></div><p className="muted">Sources never switch automatically. Hardware startup can take about 35 seconds. Physical hardware verification is pending.</p></Card>
      <Card title="Analysis Settings for Next Session"><fieldset disabled={running||active}><label>Channels With Electrodes Attached (1–8, Comma Separated)<input disabled={Boolean(device?.connected)||busy||checking} value={channels} onChange={e=>{setChannels(e.target.value);setSignal(null);setOverride(false)}}/></label><p className="muted">Only these channels are switched on and routed to the bias (RLD) noise cancellation at connect, shown on charts, checked and analyzed. Disconnect before changing channels, then reconnect. Full-rate recordings keep every acquired channel.</p><div className="form-grid"><label>Baseline / Epoch Start (ms)<input type="number" value={baseline} onChange={e=>setBaseline(Number(e.target.value))}/></label><label>Epoch Endpoint (ms)<input type="number" value={endpoint} onChange={e=>setEndpoint(Number(e.target.value))}/></label><label>P300 Start (ms)<input type="number" value={windowStart} onChange={e=>setWindowStart(Number(e.target.value))}/></label><label>P300 End (ms)<input type="number" value={windowEnd} onChange={e=>setWindowEnd(Number(e.target.value))}/></label></div></fieldset><p className="muted">Settings are submitted and validated when starting the next session. Saved results retain their original settings.</p></Card></div>
      {signalCard}
      <Card title="Backend Address"><form onSubmit={e=>{e.preventDefault();try{const url=new URL(apiDraft);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP(S) address without credentials');localStorage.setItem('neurolingo-api-url',url.origin);window.location.reload()}catch(err){setError(String(err))}}}><label>API Server URL<input type="url" required value={apiDraft} onChange={e=>setApiDraft(e.target.value)}/></label><button className="secondary" disabled={running||active}>Save Address and Reconnect</button></form><p className="muted">Local default: http://127.0.0.1:8000. Pages hosts only the frontend; the backend must be running separately. Translation remains unavailable; exploratory MMN/N400 protocols are configured through the API.</p></Card></>}
    <footer><details><summary><ShieldCheck size={16}/>About EEG Measurements</summary><p>Exploratory ERP measurement. Responses depend on attention, signal quality, experimental design, and electrode placement. EEG alone cannot establish conscious recognition or successful discrimination. Session changes are descriptive, not proof of learning. Timing uncalibrated. Physical output latency unknown.</p></details></footer>
    </div></main></div></div>;
}
