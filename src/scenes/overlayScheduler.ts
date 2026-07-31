/**
 * Deterministic ownership for report/toast handoff. Phaser owns animation time;
 * this state machine owns the ordering, so synchronous mission events cannot
 * start a toast underneath an active report.
 */
export class OverlayScheduler {
  private report = false;
  private toast = false;

  openReport(): void { this.report = true; }
  closeReport(): void { this.report = false; }
  openToast(): void { this.toast = true; }
  closeToast(): void { this.toast = false; }

  canStartToast(blocked: boolean): boolean {
    return !blocked && !this.report && !this.toast;
  }

  get reportOpen(): boolean { return this.report; }
  get toastOpen(): boolean { return this.toast; }
  get ambientOpen(): boolean { return !this.report && !this.toast; }
}
