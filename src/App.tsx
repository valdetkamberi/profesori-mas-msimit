import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Camera, Image as ImageIcon, ChevronLeft, Send, Sparkles, AlertCircle, MessageCircleQuestion, X, ArrowLeft, ArrowRight, Delete, Calculator, ArrowLeftCircle, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import 'katex/dist/katex.min.css';
import 'mathlive';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        value?: string;
        onInput?: (e: Event) => void;
        onKeyDown?: (e: any) => void;
        style?: React.CSSProperties;
      };
    }
  }
}

type Step = { id: string; equation: string; };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MATH_KEYS = [
  { latex: '\\int #0 \\, dx', display: '\\int', type: 'cmd' },
  { latex: '\\int_{#?}^{#?} #? \\, d#?', display: '\\int_a^b', type: 'cmd' },
  { latex: '\\frac{#0}{#?}', display: '\\frac{\\square}{\\square}', type: 'cmd' },
  { latex: '\\sqrt{#0}', display: '\\sqrt{\\square}', type: 'cmd' },
  { latex: '^{#?}', display: '\\square^{\\square}', type: 'cmd' },
  { latex: 'd', display: 'd', type: 'cmd' },
  { key: 'x', display: 'x', type: 'text' },
  { key: 'y', display: 'y', type: 'text' },
  { key: '(', display: '(', type: 'text' },
  { key: ')', display: ')', type: 'text' },
];

const NUM_KEYS = [
  { key: 'clear', display: 'C', type: 'action' },
  { key: 'backspace', display: '⌫', type: 'action' },
  { key: 'left', display: '←', type: 'nav' },
  { key: 'right', display: '→', type: 'nav' },
  { key: '7', display: '7', type: 'text' },
  { key: '8', display: '8', type: 'text' },
  { key: '9', display: '9', type: 'text' },
  { latex: '\\div', display: '\\div', type: 'cmd' },
  { key: '4', display: '4', type: 'text' },
  { key: '5', display: '5', type: 'text' },
  { key: '6', display: '6', type: 'text' },
  { latex: '\\times', display: '\\times', type: 'cmd' },
  { key: '1', display: '1', type: 'text' },
  { key: '2', display: '2', type: 'text' },
  { key: '3', display: '3', type: 'text' },
  { key: '-', display: '-', type: 'text' },
  { key: '0', display: '0', type: 'text' },
  { key: '.', display: '.', type: 'text' },
  { latex: '\\pi', display: '\\pi', type: 'cmd' },
  { key: '+', display: '+', type: 'text' },
];

const compressImageForUpload = (file: File): Promise<string> => {
  const maxSize = 1600;
  const quality = 0.82;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nuk mund të lexohej imazhi."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Nuk mund të përpunohej imazhi."));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error("Nuk mund të kompresohej imazhi."));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const format = file.type === 'image/png' || file.size < 600_000 ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(format, quality));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
};

export default function App() {
  const [problem, setProblem] = useState('');
  const [view, setView] = useState<'input' | 'solving' | 'solution'>('input');
  const [steps, setSteps] = useState<Step[]>([]);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [error, setError] = useState('');
  
  // Modal & Explanation State
  const [activeStep, setActiveStep] = useState<Step | null>(null);
  const [chatHistory, setChatHistory] = useState<Record<string, ChatMessage[]>>({});
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mfRef = useRef<any>(null);

  useEffect(() => {
    if (mfRef.current) {
      mfRef.current.mathVirtualKeyboardPolicy = "manual";
      mfRef.current.addEventListener('input', (e: any) => {
        setProblem(e.target.value);
      });
    }
  }, [view]);

  // Scroll to bottom of chat when new message is added
  useEffect(() => {
    if (activeStep && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, activeStep, isExplaining]);

  const handleKeyClick = (keyDef: any) => {
    if (!mfRef.current) return;
    
    if (keyDef.type === 'solve') {
      handleSolve();
      return;
    }

    if (keyDef.type === 'action') {
      switch (keyDef.key) {
        case 'clear':
          mfRef.current.setValue('');
          setProblem('');
          break;
        case 'backspace':
          mfRef.current.executeCommand('performBackspace');
          break;
      }
      mfRef.current.focus();
      return;
    }

    if (keyDef.type === 'nav') {
      switch (keyDef.key) {
        case 'left': mfRef.current.executeCommand('moveToPreviousChar'); break;
        case 'right': mfRef.current.executeCommand('moveToNextChar'); break;
        case 'up': mfRef.current.executeCommand('moveUp'); break;
        case 'down': mfRef.current.executeCommand('moveDown'); break;
      }
      mfRef.current.focus();
      return;
    }

    if (keyDef.type === 'cmd') {
      mfRef.current.insert(keyDef.latex);
    } else if (keyDef.type === 'text') {
      mfRef.current.insert(keyDef.key);
    }
    mfRef.current.focus();
  };

  const handleSolve = async () => {
    if (!problem.trim()) return;
    setView('solving');
    setError('');
    
    try {
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to solve');
      
      setSteps(data.steps || []);
      setFinalAnswer(data.finalAnswer || '');
      setView('solution');
    } catch (err: any) {
      setError(err.message);
      setView('input');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const uploadCompressedImage = async () => {
      setView('solving');
      try {
        const base64 = await compressImageForUpload(file);
        const response = await fetch('/api/extract-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Nuk mund të lexohej imazhi.");
        setProblem(data.equation);
        setView('input');
      } catch (err: any) {
        setError(err.message || "Nuk mund të lexonim imazhin. Provoni manualisht.");
        setView('input');
      }
    };
    uploadCompressedImage();
  };

  const handleExplain = async (step: Step) => {
    setActiveStep(step);
    // If we haven't explained this step yet, do the initial explanation
    if (!chatHistory[step.id] || chatHistory[step.id].length === 0) {
      await fetchExplanation(step, '');
    }
  };

  const fetchExplanation = async (step: Step, question: string) => {
    setIsExplaining(true);
    
    if (question) {
      setChatHistory(prev => ({
        ...prev,
        [step.id]: [...(prev[step.id] || []), { role: 'user', content: question }]
      }));
    }

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem,
          stepEquation: step.equation,
          question,
          chatHistory: chatHistory[step.id] || []
        })
      });
      const data = await response.json();
      
      setChatHistory(prev => ({
        ...prev,
        [step.id]: [...(prev[step.id] || []), { role: 'assistant', content: data.explanation }]
      }));
    } catch (err) {
      setChatHistory(prev => ({
        ...prev,
        [step.id]: [...(prev[step.id] || []), { role: 'assistant', content: "Ndodhi një gabim. Provoni përsëri." }]
      }));
    } finally {
      setIsExplaining(false);
      setCurrentQuestion('');
    }
  };

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentQuestion.trim() || !activeStep) return;
    fetchExplanation(activeStep, currentQuestion);
  };

  return (
    <div className="h-screen bg-[#121212] flex flex-col text-gray-100 font-sans relative overflow-hidden">
      
      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center justify-between p-4 px-6 border-b border-gray-800/50 bg-[#151515] z-10 w-full">
        <div className="flex items-center gap-4">
          <div className="text-[#FF505A] font-bold text-2xl tracking-tight flex items-center gap-2">
            <Calculator size={24} /> Profesori<span className="text-white"> mas msimit</span>
          </div>
        </div>
        
        <div className="flex items-center">
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImageUpload}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-2 lg:py-2.5 bg-[#FF505A]/10 hover:bg-[#FF505A]/20 text-[#FF505A] rounded-full transition-colors font-medium border border-[#FF505A]/20"
            >
              <ImageIcon size={18} />
              <span className="hidden sm:inline">Skano Problemin</span>
            </button>
        </div>
      </header>

      {/* ERROR TOAST */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="absolute top-20 left-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full flex items-center gap-3 z-50 shadow-2xl backdrop-blur-md whitespace-nowrap font-medium"
          >
            <AlertCircle size={20} />
            <p>{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full max-w-[1800px] mx-auto flex flex-col lg:flex-row gap-0 lg:gap-6 p-0 lg:p-6 overflow-hidden relative">
          
        {/* LEFT PANEL: Solution Display (Scrollable) */}
        <div className={`flex-1 min-w-0 flex-col bg-[#161616] lg:bg-transparent lg:rounded-3xl h-full relative order-1 ${view === 'input' ? 'hidden lg:flex' : 'flex'}`}>
           {/* Header for Solution (Mobile) */}
           {view !== 'input' && (
             <div className="lg:hidden p-4 border-b border-gray-800 flex items-center gap-2 text-gray-400 bg-[#1c1c1c] shrink-0 shadow-md z-10">
                 <button onClick={() => setView('input')} className="p-2 -ml-2 rounded-full hover:bg-gray-800 text-gray-200">
                    <ChevronLeft size={24} />
                 </button>
                 <span className="font-medium text-gray-200">Kthehu te kalkulatori</span>
             </div>
           )}

           <div className="flex-1 overflow-y-auto w-full relative flex flex-col">
              {view === 'input' && (
                 <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8">
                    <div className="w-24 h-24 rounded-[2rem] bg-gray-800/30 flex items-center justify-center mb-6 border border-gray-800 ring-4 ring-gray-900/50">
                       <Calculator size={48} className="text-[#FF505A]/70" />
                    </div>
                    <h2 className="text-3xl font-semibold text-gray-300 mb-4 tracking-tight">Gati për të Llogaritur</h2>
                    <p className="max-w-md text-gray-500 text-center text-lg leading-relaxed">Përdor panelin në të djathtë për të shkruar ekuacionin matematikor. Shtyp <strong className="text-gray-300">Zgjidh Problemin</strong> për të parë hapat me saktësi absolute.</p>
                 </div>
              )}

              {/* Solution states below the input */}
              {view === 'solving' && (
                 <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400">
                    <motion.div
                       animate={{ rotate: 360 }}
                       transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                       className="w-16 h-16 rounded-full border-4 border-gray-800 border-t-[#FF505A] mb-8 shadow-[0_0_20px_rgba(255,80,90,0.3)]"
                    />
                    <h2 className="text-2xl font-semibold text-gray-200 mb-2 tracking-tight">Duke llogaritur zgjidhjen...</h2>
                    <p className="text-lg">Ju lutem prisni, hapat po gjenerohen.</p>
                 </div>
              )}

              {view === 'solution' && (
                 <div className="flex-1 p-6 md:p-8 lg:p-12 space-y-10 pb-32">
                    <div className="space-y-12 max-w-4xl mx-auto">
                       {steps.map((step, idx) => (
                         <div key={step.id} className="relative pl-6 md:pl-8 lg:pl-10 border-l-[3px] border-gray-800 hover:border-[#FF505A]/50 transition-colors duration-300 group">
                           {/* Number Badge */}
                           <div className="absolute -left-[16px] top-1.5 bg-[#161616] border-[3px] border-gray-800 group-hover:border-[#FF505A] text-gray-500 group-hover:text-white w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors duration-300 shadow-sm">
                              {idx + 1}
                           </div>
                           <div className="text-lg md:text-xl lg:text-2xl text-gray-200 overflow-x-auto pb-4 katex-display-block leading-loose min-h-[40px] flex items-center">
                             <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                               {`$$${step.equation}$$`}
                             </ReactMarkdown>
                           </div>
                           <button 
                             onClick={() => handleExplain(step)}
                             className="text-sm flex items-center gap-2 text-[#FF505A] font-semibold opacity-70 hover:opacity-100 transition-all bg-[#FF505A]/10 hover:bg-[#FF505A]/20 px-4 py-2 rounded-xl mt-1 border border-[#FF505A]/0 hover:border-[#FF505A]/30"
                           >
                             <MessageCircleQuestion size={18} />
                             Shpjego këtë hap
                           </button>
                         </div>
                       ))}
                       
                       {finalAnswer && (
                         <div className="pt-10 border-t border-gray-800 mt-12">
                            <span className="text-xs font-bold text-[#FF505A] uppercase tracking-widest mb-6 block text-center">Rezultati Përfundimtar</span>
                            <div className="text-3xl lg:text-4xl text-[#FF505A] bg-[#FF505A]/5 px-6 py-10 rounded-3xl overflow-x-auto text-center border border-[#FF505A]/20 font-medium shadow-2xl shadow-red-500/5">
                               <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                 {`$$${finalAnswer}$$`}
                               </ReactMarkdown>
                            </div>
                         </div>
                       )}
                    </div>
                 </div>
              )}
           </div>
        </div>

        {/* RIGHT PANEL: Keyboard & Input */}
        <div className={`w-full lg:w-[450px] xl:w-[480px] shrink-0 flex flex-col justify-between bg-[#1c1c1c] lg:rounded-[2rem] shadow-2xl lg:shadow-black/70 overflow-y-auto overflow-x-hidden lg:ring-1 ring-white/10 h-full max-h-full order-2 relative z-20 ${view !== 'input' ? 'hidden lg:flex' : 'flex'}`}>
           {/* Top Section (Input Display) */}
           <div className="flex-1 flex flex-col items-center justify-center p-4 lg:p-6 w-full bg-[#161616] min-h-[160px] shrink-0">
              <math-field
                ref={mfRef}
                style={{
                  width: '100%',
                  fontSize: '2.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  textAlign: 'center',
                  fontFamily: 'inherit',
                  color: 'white',
                  padding: '10px 0',
                }}
                onKeyDown={(e: any) => {
                  if (e.key === 'Enter') handleSolve();
                }}
              >
                {problem}
              </math-field>
           </div>

           {/* Middle Section (Numpad) */}
           <div className="shrink-0 bg-[#1c1c1c] p-3 lg:p-4 border-t border-white/5 flex flex-col gap-3 w-full z-10">
              <div className="flex gap-3">
                 {/* Math Keys */}
                 <div className="grid grid-cols-2 gap-2 flex-[2]">
                   {MATH_KEYS.map((keyDef, i) => (
                      <button
                        key={`math-${i}`}
                        onClick={() => handleKeyClick(keyDef)}
                        className="h-12 lg:h-[3.25rem] xl:h-[3.5rem] bg-[#262626] hover:bg-[#333333] text-gray-300 rounded-2xl flex items-center justify-center transition-all active:scale-95 shadow-sm select-none touch-manipulation"
                      >
                         {keyDef.type === 'text' ? (
                            <span className="font-sans text-xl font-medium">{keyDef.display}</span>
                         ) : (
                            <span className="katex-preview pointer-events-none text-xl">
                              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{`$${keyDef.display}$`}</ReactMarkdown>
                            </span>
                         )}
                      </button>
                   ))}
                 </div>
                 {/* Number Keys */}
                 <div className="grid grid-cols-4 gap-2 flex-[4]">
                   {NUM_KEYS.map((keyDef, i) => {
                      const isAction = keyDef.type === 'action' || keyDef.type === 'nav';
                      const isNumber = /^[0-9.]$/.test(keyDef.key || '');
                      return (
                        <button
                          key={`num-${i}`}
                          onClick={() => handleKeyClick(keyDef)}
                          className={`
                            h-12 lg:h-[3.25rem] xl:h-[3.5rem] rounded-2xl flex items-center justify-center transition-all select-none touch-manipulation font-sans active:scale-95 shadow-sm
                            ${isAction ? 'bg-[#262626] hover:bg-[#333333] text-gray-400 text-lg' : 
                              isNumber ? 'bg-[#404040] hover:bg-[#4d4d4d] text-gray-100 text-xl lg:text-2xl font-medium shadow-[0_2px_0_rgba(0,0,0,0.3)]' :
                              'bg-[#333333] hover:bg-[#404040] text-gray-300 text-xl font-medium'}
                          `}
                        >
                           {keyDef.type === 'cmd' ? (
                             <span className="katex-preview pointer-events-none">
                               <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{`$${keyDef.display}$`}</ReactMarkdown>
                             </span>
                           ) : (
                             <span className="block mt-[2px]">{keyDef.display}</span>
                           )}
                        </button>
                      );
                   })}
                 </div>
              </div>
           </div>

           {/* Bottom Section (Zgjidh Button) */}
           <div className="p-3 lg:p-4 bg-[#1c1c1c] shrink-0 border-t border-black/20 pb-4 lg:pb-6 z-10 w-full mb-2">
              <button 
                onClick={handleSolve}
                className="w-full h-14 lg:h-16 bg-[#FF505A] hover:bg-[#ff6973] text-white rounded-2xl font-bold text-xl tracking-wide shadow-[0_4px_15px_rgba(255,80,90,0.3)] transition-all active:scale-[0.98] flex items-center justify-center uppercase"
              >
                Zgjidh Problemin
              </button>
           </div>
        </div>

      </main>

      {/* EXPLANATION MODAL */}
      <AnimatePresence>
        {activeStep && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveStep(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            {/* Modal Panel */}
            <motion.div 
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-[600px] lg:w-[700px] h-[80vh] md:h-[70vh] bg-[#1a1a1a] rounded-t-3xl shadow-[0_-20px_50px_rgba(0,0,0,0.5)] z-50 flex flex-col border border-gray-700/50 border-b-0"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-[#1e1e1e] rounded-t-3xl">
                <h3 className="font-semibold text-gray-200">Shpjegimi i Hapit</h3>
                <button 
                  onClick={() => setActiveStep(null)}
                  className="p-2 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Equation Reference */}
              <div className="p-4 bg-gray-900/50 border-b border-gray-800 text-center overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {`$$${activeStep.equation}$$`}
                </ReactMarkdown>
              </div>

              {/* Chat Area */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {chatHistory[activeStep.id]?.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user' 
                        ? 'bg-gray-800 text-gray-100 rounded-tr-sm' 
                        : 'bg-[#FF505A]/10 border border-[#FF505A]/20 text-gray-200 rounded-tl-sm prose prose-invert prose-p:leading-relaxed max-w-none'
                    }`}>
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                {isExplaining && (
                  <div className="flex justify-start">
                    <div className="bg-[#FF505A]/10 border border-[#FF505A]/20 text-[#FF505A] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                       <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-2 h-2 rounded-full bg-[#FF505A]" />
                       <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-2 h-2 rounded-full bg-[#FF505A]" />
                       <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-2 h-2 rounded-full bg-[#FF505A]" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={submitQuestion} className="p-4 border-t border-gray-800 bg-[#1e1e1e]">
                <div className="relative">
                  <input
                    type="text"
                    value={currentQuestion}
                    onChange={(e) => setCurrentQuestion(e.target.value)}
                    placeholder="Keni ndonjë pyetje për këtë hap?"
                    className="w-full bg-gray-900 border border-gray-800 rounded-full pl-5 pr-12 py-3.5 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#FF505A]/50 focus:ring-1 focus:ring-[#FF505A]/50"
                  />
                  <button 
                    type="submit"
                    disabled={!currentQuestion.trim() || isExplaining}
                    className="absolute right-2 top-2 bottom-2 aspect-square bg-[#FF505A] hover:bg-[#ff6973] disabled:opacity-50 text-white rounded-full flex items-center justify-center transition-colors"
                  >
                    <Send size={18} className="-ml-0.5" />
                  </button>
                </div>
              </form>

            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
