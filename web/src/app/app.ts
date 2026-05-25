import { Component, signal } from '@angular/core';
import { LobbyComponent } from './lobby/lobby.component';
import { CallComponent } from './call/call.component';
import type { CallParams } from './lobby/lobby.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LobbyComponent, CallComponent],
  template: `
    @if (callParams()) {
      <app-call [params]="callParams()!" (leave)="exitCall()" />
    } @else {
      <app-lobby (join)="enterCall($event)" />
    }
  `,
})
export class App {
  callParams = signal<CallParams | null>(null);

  enterCall(params: CallParams) {
    this.callParams.set(params);
  }

  exitCall() {
    this.callParams.set(null);
  }
}
