import OfficeComponent from './office-component.mjs';
import { renderAccount } from '../account.mjs';

class OfficeAccount extends OfficeComponent {
  model = {};
  render() {
    this.append(this.createElement('div', { class: 'account-view' }));
  }
  initialize() {
    this.load = () => {
      if (this.loading) return this.loading;
      this.loading = renderAccount(this.querySelector('.account-view'), {
        onUserChanged: user => this.emit('account-user-change', { user }),
      }).finally(() => { this.loading = null; });
      return this.loading;
    };
  }
}
customElements.define('office-account', OfficeAccount);
