/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { t } from 'ttag';
import $ from 'jquery';
import ModalSendTx from '../components/ModalSendTx';
import SendTokensOne from '../components/SendTokensOne';
import { connect } from "react-redux";
import BackButton from '../components/BackButton';
import hathorLib from '@hathor/wallet-lib';
import wallet from '../utils/wallet';
import ModalAlertNotSupported from '../components/ModalAlertNotSupported';
import ModalAlert from '../components/ModalAlert';
import SendTxHandler from '../components/SendTxHandler';
import ledger, { LedgerError } from '../utils/ledger';
import tokens from '../utils/tokens';
import version from '../utils/version';
import { IPC_RENDERER, LEDGER_TX_CUSTOM_TOKEN_LIMIT } from '../constants';
import ReactLoading from 'react-loading';
import colors from '../index.scss';

const mapStateToProps = (state) => {
  return {
    tokens: state.tokens,
    wallet: state.wallet,
    metadataLoaded: state.metadataLoaded,
    useWalletService: state.useWalletService,
  };
};


/**
 * Screen used to send tokens to another wallet.
 * Can send more than one token in the same transaction.
 *
 * @memberof Screens
 */
class SendTokens extends React.Component {
  constructor(props) {
    super(props);

    // Holds the children components references
    this.references = [React.createRef()];

    // Partial data while waiting tx mining to add nonce and parents
    this.data = null;

    // Send transaction object used when sending tx with ledger
    this.sendTransaction = null;

    /**
     * errorMessage {string} Message to be shown in case of error in form
     * txTokens {Array} Array of tokens configs already added by the user (start with only hathor)
     * ledgerStep {number} When sending tx with ledger we have a step that needs user physical input, then we move to next step
     */
    this.state = {
      errorMessage: '',
      txTokens: [hathorLib.constants.HATHOR_TOKEN_CONFIG],
      ledgerStep: 0,
      ledgerModalTitle: t`Validate outputs on Ledger`,
      ledgerAlertModalTitle: null,
      ledgerAlertModalBody: null,
      data: null,
    };
  }

  componentDidMount() {
    if (IPC_RENDERER) {
      IPC_RENDERER.on("ledger:txSent", this.handleTxSent);
      IPC_RENDERER.on("ledger:signatures", this.handleSignatures);
      IPC_RENDERER.on("ledger:tokenDataSent", this.handleSendToken);
    }
  }

  componentWillUnmount() {
    if (IPC_RENDERER) {
      IPC_RENDERER.removeAllListeners("ledger:txSent");
      IPC_RENDERER.removeAllListeners("ledger:signatures");
      IPC_RENDERER.removeAllListeners("ledger:tokenDataSent");
    }
  }

  /**
   * Handle the response of a send tx call to Ledger.
   *
   * @param {IpcRendererEvent} event May be used to reply to the event
   * @param {Object} arg Data returned from the send tx call
   */
  handleTxSent = (event, arg) => {
    if (arg.success) {
      this.getSignatures();
    } else {
      this.handleSendError(new LedgerError(arg.error.message));
    }
  }

  /**
   * Handle the response of a get signatures call to Ledger.
   *
   * @param {IpcRendererEvent} event May be used to reply to the event
   * @param {Object} arg Data returned from the get signatures call
   */
  handleSignatures = (event, arg) => {
    if (arg.success) {
      this.onLedgerSuccess(arg.data);
    } else {
      this.handleSendError(new LedgerError(arg.error.message));
    }
  }

  /**
   * Handle the response of a send token data call to Ledger.
   * Will list all tokens that failed verification, if all pass then start sign tx
   *
   * @param {IpcRendererEvent} event May be used to reply to the event
   * @param {Object} arg Data returned from the send token data call
   */
  handleSendToken = (event, arg) => {
    // If a token does not pass:
    // modal to warn and either sign or cancel (use component)
    if (arg.success) {
      // arg.data is a list of failed uids
      if (arg.data.length === 0) {
        // send cached data
        this.executeSendLedger();
        return;
      }
      // some token was invalid, it will be on arg, which ones
      const tokenList = this.state.txTokens.filter(t => arg.data.includes(t.uid))
      this.setState({
        ledgerAlertModalTitle: t`Invalid custom tokens`,
        ledgerAlertModalBody: this.renderAlertTokenList(tokenList),
      });
      $("#ledgerAlertModal").modal('show');
    } else {
      this.handleSendError(new LedgerError(arg.error.message));
    }
  }

  /**
   * Check if form is valid
   *
   * @return {boolean}
   */
  validateData = () => {
    const isValid = this.refs.formSendTokens.checkValidity();
    if (isValid === false) {
      this.refs.formSendTokens.classList.add('was-validated');
    } else {
      this.refs.formSendTokens.classList.remove('was-validated');
    }
    return isValid;
  }

  /**
   * Get inputs and outputs data from child components
   * Each child component holds inputs/outputs for one token
   *
   * @return {Object} Object holding all inputs and outputs {'inputs': [...], 'outputs': [...]}
   */
  getData = () => {
    let data = {'inputs': [], 'outputs': [], 'tokens': []};
    for (const ref of this.references) {
      const instance = ref.current;
      let dataOne = instance.getData();
      if (!dataOne) return;
      data['inputs'] = [...data['inputs'], ...dataOne['inputs']];
      data['outputs'] = [...data['outputs'], ...dataOne['outputs']];
    }
    return data;
  }

  /**
   * Add signature to each input and execute send transaction
   */
  onLedgerSuccess = (signatures) => {
    try {
      // Prepare data and submit job to tx mining API
      const arr = [];
      for (let i=0;i<signatures.length;i++) {
        arr.push(Buffer.from(signatures[i]));
      }
      this.sendTransaction.prepareTxFrom(arr);
      this.setState({ ledgerStep: 1, ledgerModalTitle: t`Sending transaction` });
    } catch(e) {
      this.handleSendError(e);
    }
  }

  /**
   * Execute ledger get signatures
   */
  getSignatures = () => {
    const keys = hathorLib.wallet.getWalletData().keys;
    ledger.getSignatures(Object.assign({}, this.data), keys);
  }

  /**
   * Method executed when tx is sent with success
   *
   * @param {Object} tx Transaction sent data
   */
  onSendSuccess = (tx) => {
    $('#alertModal').modal('hide');
    // Must update the shared address, in case we have used one for the change
    wallet.updateSharedAddress();
    this.props.history.push('/wallet/');
  }

  /**
   * Method executed when there is an error sending the tx
   *
   * @param {String} message Error message
   */
  onSendError = (message) => {
    $('#alertModal').modal('hide');
    this.setState({ errorMessage: message, ledgerStep: 0 });
  }

  /**
   * Method executed before sending a tx to be signed by Ledger
   *
   * Checks if we have any custom token, if not we just send to sign
   * If we have custom tokens we must send all tokens first
   * When all tokens are sent we should send the tx to sign
   */
  beforeSendLedger = () => {
    // remove HTR if present
    const txTokens = this.state.txTokens.filter(t => !hathorLib.tokens.isHathorToken(t.uid));

    if (txTokens.length === 0) {
      // no custom tokens, just send
      this.executeSendLedger();
      return;
    }
    // get all custom tokens, and include the signatures
    const tokenSignatures = tokens.getTokenSignatures();
    const missingSigs = txTokens.filter(t => !tokenSignatures.hasOwnProperty(t.uid));
    if (missingSigs.length !== 0) {
      // there are tokens without signatures, missingSigs
      // set tittle and content
      this.setState({
        ledgerAlertModalTitle: t`Unverified custom tokens`,
        ledgerAlertModalBody: this.renderAlertTokenList(missingSigs),
      });
      $("#ledgerAlertModal").modal('show');
      return;
    }

    const tokenSigs = txTokens.map(t => {
      return {
        uid: t.uid,
        symbol: t.symbol,
        name: t.name,
        signature: tokenSignatures[t.uid],
      };
    });

    ledger.sendTokens(tokenSigs);
  }

  /**
   * Method executed to send transaction on ledger
   * It opens the ledger modal to wait for user action on the device
   */
  executeSendLedger = () => {
    // Wallet Service currently does not support Ledger, so we default to the regular SendTransaction
    this.sendTransaction = new hathorLib.SendTransaction({
      outputs: this.data.outputs,
      inputs: this.data.inputs,
      network: this.props.wallet.getNetworkObject(),
    });

    try {
      // Errors may happen in this step ( ex.: insufficient amount of tokens )
      this.data = this.sendTransaction.prepareTxData();
    }
    catch (e) {
      this.setState({ errorMessage: e.message, ledgerStep: 0 })
      return;
    }

    // Complete data with default values
    hathorLib.transaction.completeTx(this.data);

    const changeInfo = [];
    const keys = hathorLib.wallet.getWalletData().keys;
    this.data.outputs.forEach((output, outputIndex) => {
      if (output.isChange) {
        changeInfo.push({
          outputIndex,
          keyIndex: keys[output.address].index,
        });
      }
    });

    const useOldProtocol = !version.isLedgerCustomTokenAllowed();

    ledger.sendTx(this.data, changeInfo, useOldProtocol);
    $('#alertModal').modal('show');
  }

  /**
   * Method executed when user validates its PIN on the modal
   * Checks if the form is valid, get data from child components, complete the transaction and execute API request
   */
  beforeSend = () => {
    const isValid = this.validateData();
    if (!isValid) return;
    let data = this.getData();
    if (!data) return;
    this.setState({ errorMessage: '' });
    try {
      this.data = data;
      if (hathorLib.wallet.isSoftwareWallet()) {
        $('#pinModal').modal('show');
      } else {
        this.beforeSendLedger();
      }
    } catch(e) {
      this.handleSendError(e);
    }
  }

  /**
   * Prepare data before sending tx to be mined and after user writes PIN
   *
   * @param {String} pin PIN written by the user
   *
   * @return {SendTransaction} SendTransaction object, in case of success, null otherwise
   */
  prepareSendTransaction = async (pin) => {
    if (this.props.useWalletService) {
      return new hathorLib.SendTransactionWalletService(this.props.wallet, {
        outputs: this.data.outputs,
        inputs: this.data.inputs,
        pin,
      });
    }

    return new hathorLib.SendTransaction({ outputs: this.data.outputs, inputs: this.data.inputs, pin, network: this.props.wallet.getNetworkObject() });
  }

  /**
   * Handle error when executing sendTransaction method of the lib
   */
  handleSendError = (e) => {
    if (e instanceof hathorLib.errors.AddressError ||
        e instanceof hathorLib.errors.OutputValueError ||
        e instanceof hathorLib.errors.ConstantNotSet ||
        e instanceof hathorLib.errors.MaximumNumberOutputsError ||
        e instanceof hathorLib.errors.MaximumNumberInputsError ||
        e instanceof LedgerError) {
      $('#alertModal').modal('hide');
      this.setState({ errorMessage: e.message, ledgerStep: 0 });
    } else {
      // Unhandled error
      throw e;
    }
  }

  /**
   * Update class state
   *
   * @param {Object} newState New state for the class
   */
  updateState = (newState) => {
    this.setState(newState);
  }

  /**
   * Executed when user clicks to add another token to this transaction
   * Checks if still have a known token available that is not selected yet
   * Create a new child reference with this new token
   */
  addAnotherToken = () => {
    if (hathorLib.wallet.isHardwareWallet()) {
      if (!version.isLedgerCustomTokenAllowed()) {
        // Custom token not allowed for this Ledger version
        $('#notSupported').modal('show');
        return;
      }
      if (this.state.txTokens.filter(t => !hathorLib.tokens.isHathorToken(t.uid)).length === LEDGER_TX_CUSTOM_TOKEN_LIMIT) {
        // limit is 10 custom tokens per tx
        const modalBody = <p>{t`Ledger has a limit of ${LEDGER_TX_CUSTOM_TOKEN_LIMIT} different tokens per transaction.`}</p>
        this.setState({
          ledgerAlertModalTitle: t`Token limit reached`,
          ledgerAlertModalBody: modalBody,
        });
        $("#ledgerAlertModal").modal('show');
        return;
      }
    }

    if (this.state.txTokens.length === this.props.tokens.length) {
      this.setState({ errorMessage: t`All your tokens were already added` });
      return;
    }

    // Among all the token options we choose the first one that is not already selected
    const newToken = this.props.tokens.find((token) => {
      return this.state.txTokens.find((txToken) =>
        txToken.uid === token.uid
      ) === undefined
    });

    this.references.push(React.createRef());
    const txTokens = [...this.state.txTokens, newToken];
    this.setState({ txTokens });
  }

  /**
   * Called when the select of a new token has changed
   * Used to change the selects in all other child components because the selected token can't be selected anymore
   *
   * @param {Object} selected Config of token that was selected {'name', 'symbol', 'uid'}
   * @param {number} index Index of the child component
   */
  tokenSelectChange = (selected, index) => {
    let txTokens = [...this.state.txTokens];
    txTokens[index] = selected;
    this.setState({ txTokens });
  }

  /**
   * Called when user removes a child component (removes a token)
   *
   * @param {number} index Index of the child component
   */
  removeToken = (index) => {
    let txTokens = [...this.state.txTokens];
    txTokens.splice(index, 1);
    this.setState({ txTokens });
    this.references.splice(index, 1);
  }

  /**
   * Called when user clicks on send tokens button
   * Open pin modal if software wallet and execute send otherwise
   */
  onSendTokensClicked = () => {
    this.beforeSend();
  }

  renderAlertTokenList = (tokenList) => {
    const rows = tokenList.map(t => <li key={t.uid}><p>{t.name} ({t.symbol})</p></li>)
    return <ul>{rows}</ul>
  }

  render = () => {
    const renderOnePage = () => {
      return this.state.txTokens.map((token, index) => {
        return <SendTokensOne key={`${token.uid}-${index}`} ref={this.references[index]} config={token} index={index} selectedTokens={this.state.txTokens} tokens={this.props.tokens} tokenSelectChange={this.tokenSelectChange} removeToken={this.removeToken} updateState={this.updateState} />
      });
    }

    const renderPage = () => {
      if (!this.props.metadataLoaded) {
        return <p>{t`Loading metadata...`}</p>
      }

      return (
        <div>
          <form ref="formSendTokens" id="formSendTokens">
            {renderOnePage()}
            <div className="mt-5">
              <button type="button" className="btn btn-secondary mr-4" onClick={this.addAnotherToken}>{t`Add another token`}</button>
              <button type="button" className="btn btn-hathor" onClick={this.onSendTokensClicked}>{t`Send Tokens`}</button>
            </div>
          </form>
          <p className="text-danger mt-3 white-space-pre-wrap">{this.state.errorMessage}</p>
        </div>
      );
    }

    const renderAlertBody = () => {
      if (this.state.ledgerStep === 0) {
        return (
          <div>
            <p>{t`Please go to you Ledger and validate each output of your transaction. Press both buttons in case the output is correct.`}</p>
            <p>{t`In the end, a final screen will ask you to confirm sending the transaction.`}</p>
          </div>
        );
      } else {
        return (
          <div className="d-flex flex-row">
            <SendTxHandler sendTransaction={this.sendTransaction} onSendSuccess={this.onSendSuccess} onSendError={this.onSendError} />
            <ReactLoading type='spin' color={colors.purpleHathor} width={24} height={24} delay={200} />
          </div>
        )
      }
    }

    const renderLedgerModals = () => {
      if (hathorLib.wallet.isSoftwareWallet()) return null;

      let notSupportedModal = (
        <ModalAlertNotSupported>
          <div>
            <p>{t`Unfortunately this feature is not supported with the Hathor app version on your Ledger device. If you need this feature, you can use it by installing the most recent Hathor app.`}</p>
          </div>
        </ModalAlertNotSupported>
      );

      return (
        <div>
          {hathorLib.wallet.isHardwareWallet() && !version.isLedgerCustomTokenAllowed() && notSupportedModal}
          <ModalAlert title={this.state.ledgerModalTitle} showFooter={false} body={renderAlertBody()} />
          <ModalAlert id="ledgerAlertModal" title={this.state.ledgerAlertModalTitle} body={this.state.ledgerAlertModalBody} buttonName={t`Close`} />
        </div>
      );
    }

    return (
      <div className="content-wrapper flex align-items-center">
        <BackButton {...this.props} />
        <h3 className="mt-4 mb-4">{t`Send Tokens`}</h3>
        {renderPage()}
        <ModalSendTx prepareSendTransaction={this.prepareSendTransaction} onSendSuccess={this.onSendSuccess} onSendError={this.onSendError} title={t`Sending transaction`} />
        {renderLedgerModals()}
      </div>
    );
  }
}

export default connect(mapStateToProps)(SendTokens);
