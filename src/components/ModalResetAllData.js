/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { t } from 'ttag';
import hathorLib from '@hathor/wallet-lib';
import { CONFIRM_RESET_MESSAGE } from '../constants';
import SpanFmt from './SpanFmt';


/**
 * Component that shows a modal to ask form confirmation data to reset the wallet  
 * Asks for the password and for the user to write a sentence saying that really wants to reset
 *
 * @memberof Components
 */
class ModalResetAllData extends React.Component {
  /**
   * @property {string} errorMessage Message to be shown to the user in case of error in the form
   * @property {boolean} [forgotPassword] Identifies if the user has forgotten their password
   */
  state = { errorMessage: '', forgotPassword: false };

  /**
   * Method to be called when user clicks the button to confirm  
   * Validates the form and then calls a method from props to indicate success
   *
   * @param {Object} e Event emitted when button is clicked
   */
  handleConfirm = (e) => {
    e.preventDefault();

    // Form is invalid
    if (this.refs.formConfirm.checkValidity() === false) {
      this.refs.formConfirm.classList.add('was-validated')
      return
    }

    this.refs.formConfirm.classList.remove('was-validated')
    const password = this.refs.password.value
    const forgotPassword = this.state.forgotPassword

    // Confirmation message was incorrect
    if (this.refs.confirmMessage.value.toLowerCase() !== CONFIRM_RESET_MESSAGE.toLowerCase()) {
      this.setState({errorMessage: t`Confirmation message does not match`})
      return
    }

    // Password was not informed nor did the user forget it
    if (!password && !forgotPassword) {
      this.setState({errorMessage: t`You must write your password or check that you have forgotten it`})
      return
    }

    // Password was informed and it is incorrect
    const correctPassword = hathorLib.wallet.isPasswordCorrect(password)
    if (password && !correctPassword) {
      this.setState({errorMessage: t`Invalid password`})
      return
    }

    // Password was informed and correct OR password was forgotten: we can proceed to wallet reset.
    this.props.success()
  }

  /**
   * Method to be called when user clicks the "Forgot Password" checkbox
   * In case the user forgot the password, the "Password" field is disabled and cleared
   * @param {Object} e Event emitted when checkbox is clicked
   */
  setForgotPassword = (e) => {
    this.setState(state => ({forgotPassword: !state.forgotPassword}))

    // Clearing password field if the user did forget it
    if (!this.state.forgotPassword) {
      this.refs.password.value = ''
    }
  }

  /**
   * Method to be called when user closes the modal with the "No" button
   * Clears the form validation and fields.
   * @param {Object} e Event emitted when button is clicked
   */
  onDismiss = (e) => {
    // Form cleanup
    this.refs.formConfirm.classList.remove('was-validated')
    this.refs.password.value = ''
    this.refs.confirmMessage.value = ''
    this.setState({
      forgotPassword: false,
      errorMessage: ''
    })
  }

  render() {
    const getFirstMessage = () => {
      let firstMessage = t`If you reset your wallet, all data will be deleted, and you will lose access to your tokens. To recover access to your tokens, you will need to import your words again.`;
      if (!hathorLib.wallet.isBackupDone()) {
        firstMessage = t`${firstMessage} You still haven't done the backup of your words.`;
      }
      return firstMessage;
    }
    return (
      <div className="modal fade" id="confirmResetModal" tabIndex="-1" role="dialog" aria-labelledby="confirmResetModal" aria-hidden="true">
        <div className="modal-dialog" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="exampleModalLabel">{t`Reset all data`}</h5>
              <button type="button" className="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="modal-body">
              <p>{getFirstMessage()}</p>
              <p><SpanFmt>{t`If you still wanna do it, we need your password and for you to write down **'${CONFIRM_RESET_MESSAGE}'** to confirm the operation.`}</SpanFmt></p>
              <form ref="formConfirm">
                <div className="form-group">
                  <label htmlFor="password">{t`Password*`}</label>
                  <input type="password" ref="password" autoComplete="off" className="pin-input form-control"
                         disabled={this.state.forgotPassword} required={!this.state.forgotPassword} />
                </div>
                <div className="form-group">
                  <label htmlFor="confirmMessage">{t`Confirm message*`}</label>
                  <input type="text" ref="confirmMessage" placeholder={t`Write '${CONFIRM_RESET_MESSAGE}'`} className="form-control" required />
                </div>
                <div className="form-check">
                  <input ref="forgotPassword" type="checkbox" className="form-check-input" id="forgotPassword"
                         checked={this.state.forgotPassword} onChange={this.setForgotPassword}/>
                  <label className="form-check-label" htmlFor="forgotPassword">{t`I forgot my password`}</label>
                </div>
              </form>
              <div className="row mt-3">
                <div className="col-12 col-sm-10">
                    <p className="error-message text-danger">
                      {this.state.errorMessage}
                    </p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={this.onDismiss} type="button" className="btn btn-secondary" data-dismiss="modal">{t`No`}</button>
              <button onClick={this.handleConfirm} type="button" className="btn btn-hathor">{t`Yes`}</button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default ModalResetAllData;
