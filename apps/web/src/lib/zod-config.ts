import { z } from "zod";

/*
 * Zod normally tests whether it may compile faster validators with
 * `new Function()`. Under our Content Security Policy that is (rightly)
 * forbidden: the test fails harmlessly, but every page reported a CSP
 * violation, which would drown out real ones (Stage 15). "jitless" skips the
 * test and uses the interpreter: no measurable difference for the browser.
 */
z.config({ jitless: true });
