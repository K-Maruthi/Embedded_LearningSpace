<script>
/* Incremental advanced C topics. These remain in stage 3 because they deepen
   language/compiler/CPU semantics rather than adding another application layer. */
(function addAdvancedTopics() {
  var stage = null;
  for (var i = 0; i < STAGES.length; i++) {
    if (STAGES[i].id === "s3") { stage = STAGES[i]; break; }
  }
  if (!stage) { throw new Error("Advanced-topic extension could not find stage s3"); }

  function has(id) {
    for (var i = 0; i < STAGES.length; i++)
      for (var j = 0; j < STAGES[i].topics.length; j++)
        if (STAGES[i].topics[j].id === id) return true;
    return false;
  }

  var topics = [
    {
      id:"inlineasm", code:"3.20", t:"Extended inline assembly and compiler contracts",
      kick:"Inline assembly is a contract with the compiler, not just instructions pasted into C.",
      tags:["compiler","arm","advanced"], prereq:["compiler","volatilek","barriers"],
      L:{idea:"Extended inline assembly lets C express instructions and machine state that ordinary C cannot name.",
         compile:"Constraints such as =r, r and immediate forms tell the compiler where operands live. A memory clobber constrains compiler memory assumptions but is not a CPU fence.",
         link:"The emitted instructions live in .text and may contain relocations just like compiler-generated assembly.",
         mem:"Operands may be registers or memory selected by the compiler; an asm statement does not automatically imply a fixed address.",
         run:"The CPU executes the encoded instructions, but an incorrect constraint can make surrounding C observe stale or overwritten values.",
         hw:"MRS/MSR, barriers and special-register access can change processor state; exact instructions are architecture-specific.",
         design:"Prefer CMSIS/compiler intrinsics when they express the operation; isolate unavoidable asm behind a small documented interface.",
         trap:"Adding volatile to the asm template does not automatically make the surrounding memory accesses ordered."},
      q:{ask:"What does a memory clobber not provide by itself?",
         ans:"It constrains compiler memory assumptions; it does not by itself emit the hardware memory-ordering instruction required by the CPU contract."}
    },
    {
      id:"ldrexstrex", code:"3.21", t:"Exclusive monitors: LDREX / STREX",
      kick:"Atomic read-modify-write can be implemented as a reservation followed by a conditional store.",
      tags:["arm","atomic","concurrency"], prereq:["atomicity","isrshare"],
      L:{idea:"Exclusive operations implement a retryable atomic update: load while reserving, compute, then store only if the reservation is still valid.",
         compile:"C11 atomics may lower to exclusive instructions or another target-specific sequence with the required memory ordering.",
         link:"The instructions remain ordinary code in .text; compiler runtime helpers may be used when native instructions are unavailable.",
         mem:"The monitored object must meet alignment and memory-type requirements; cache/coherency rules matter on richer systems.",
         run:"LDREX establishes a reservation and STREX reports success or failure. Failure is expected and the algorithm retries.",
         hw:"Local/global monitoring and invalidation rules are architecture-specific and can involve other bus masters or contexts.",
         design:"Use the C atomic abstraction first; understand the instruction sequence so contention and progress can be analysed.",
         trap:"An exclusive pair is not an unconditional critical section: the reservation can be lost before STREX."},
      q:{ask:"Why can STREX fail immediately after LDREX?",
         ans:"The exclusive reservation may have been cleared by another access or architectural event, so the conditional store reports failure and the algorithm retries."}
    },
    {
      id:"faultescalation", code:"3.22", t:"Cortex-M fault escalation and lockup",
      kick:"A HardFault can be the endpoint of escalation rather than the original failure.",
      tags:["arm","faults","debug","safety"], prereq:["faults","vectors","isr"],
      L:{idea:"Cortex-M separates configurable fault classes such as MemManage, BusFault and UsageFault from HardFault.",
         compile:"Handlers are ordinary compiled functions, but their exception ABI, vector entry and compiler configuration affect the quality of captured context.",
         link:"The vector table and handlers must be retained and placed in executable memory by the linker.",
         mem:"SCB status registers and the stacked exception frame provide key forensic state: fault class, address where available, PC and LR.",
         run:"A configurable fault can escalate to HardFault when not enabled or not handled; another fault during critical exception handling can lead to processor lockup.",
         hw:"SCB fault-status registers are hardware evidence; exact bits vary by Cortex-M revision.",
         design:"Capture evidence before resetting and distinguish the original configurable fault from the escalation mechanism.",
         trap:"Logging only the HardFault number throws away the evidence needed to identify the first broken contract."},
      q:{ask:"Where should a HardFault investigation usually look first?",
         ans:"At configurable fault status, the stacked PC/LR and fault address where available, because HardFault may only be the escalation destination."}
    },
    {
      id:"mpuvariants", code:"3.23", t:"PMSAv7 versus PMSAv8 MPU models",
      kick:"The MPU protects memory by region, but the programming model changes across Cortex-M generations.",
      tags:["arm","mpu","safety","memory"], prereq:["faultescalation","memarray"],
      L:{idea:"An MPU creates access permissions and memory attributes without requiring full virtual memory; its purpose is spatial containment.",
         compile:"The compiler sees pointers and sections, while the MPU enforces a separate hardware policy over addresses and access types.",
         link:"The linker determines addresses and section boundaries; the MPU configuration must match those final runtime addresses.",
         mem:"Regions describe executable/read/write permissions and memory attributes. Granularity can create protection-map gaps or wasted space.",
         run:"An invalid access raises a memory-protection exception where supported, producing a fault context for diagnosis.",
         hw:"PMSAv7 commonly uses region base/size programming; PMSAv8-M uses a base/limit style model with a different attribute programming model. Exact capabilities are core-specific.",
         design:"Choose protection boundaries that contain meaningful failure domains, then verify the map against the final linker layout.",
         trap:"Assuming that all Cortex-M MPUs use the same region programming model or that pointer casts can bypass hardware permissions."},
      q:{ask:"Why must MPU configuration be checked against the linker map?",
         ans:"The MPU protects physical runtime addresses, while the linker decides where sections actually land. A correct policy applied to the wrong address range protects the wrong thing."}
    }
  ];

  topics.forEach(function (t) {
    if (!has(t.id)) stage.topics.push(t);
  });
})();
</script></script>
