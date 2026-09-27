/* Startup for the Compilation Path lab teaching MCU (Cortex-M4).
   Deliberately minimal and linear so the reset story matches the lab:
   vector table -> .data copy -> .bss zeroing -> main -> halt. */
  .syntax unified
  .cpu cortex-m4
  .thumb

  .section .isr_vector,"a",%progbits
  .align 2
  .global __isr_vector
__isr_vector:
  .word _estack            /* initial stack pointer */
  .word Reset_Handler      /* reset vector */
  .word NMI_Handler
  .word HardFault_Handler

  .text
  .align 2
  .global Reset_Handler
  .type Reset_Handler, %function
Reset_Handler:
  /* Copy the .data initialization image from Flash to its RAM address range. */
  ldr r0, =_sdata
  ldr r1, =_edata
  ldr r2, =_sidata
copy_data:
  cmp r0, r1
  bge zero_bss
  ldr r3, [r2], #4
  str r3, [r0], #4
  b   copy_data
  /* Zero the .bss range. */
zero_bss:
  ldr r0, =_sbss
  ldr r1, =_ebss
  movs r2, #0
zero_loop:
  cmp r0, r1
  bge call_main
  str r2, [r0], #4
  b   zero_loop
call_main:
  bl main
hang:
  b hang
  .size Reset_Handler, .-Reset_Handler

  .weak NMI_Handler
  .type NMI_Handler, %function
NMI_Handler:
  b .
  .size NMI_Handler, .-NMI_Handler

  .weak HardFault_Handler
  .type HardFault_Handler, %function
HardFault_Handler:
  b .
  .size HardFault_Handler, .-HardFault_Handler
