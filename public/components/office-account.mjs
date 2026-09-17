import OfficeComponent from './office-component.mjs';
import { renderAccount } from '../account.mjs';

class OfficeAccount extends OfficeComponent {
  model = { tab: 'profile' };
  render() {
    this.append(this.createElement('div', { class: 'account-view' }));
  }
  initialize() {
    this.update = () => this.controller?.selectTab(this.model.tab);
    this.load = () => {
      if (this.controller) { this.update(); return Promise.resolve(); }
      if (this.loading) return this.loading;
      this.loading = renderAccount(this.querySelector('.account-view'), {
        onTabChange: tab => this.emit('office-navigate', { href: `/account/${tab}` }),
        onUserChanged: user => this.emit('account-user-change', { user }),
      }).then(controller => { this.controller = controller; this.update(); }).finally(() => { this.loading = null; });
      return this.loading;
    };
  }
}
customElements.define('office-account', OfficeAccount);
