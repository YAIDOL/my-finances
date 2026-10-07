import { Amount } from './ui';

export const WALLET_IMAGE = import.meta.env.BASE_URL + 'assets/wallet-3d.webp';

/** Cash has its own visual identity, with no bank-card number or chip. */
export function CashAccount({ name, balance, hide, color = 'navy' }: { name: string; balance: number; hide: boolean; color?: string }) {
  return <div className={'cash-account ' + color}>
    <div className="cash-account-copy">
      <span className="cash-account-kind">Готівковий рахунок</span>
      <strong className="cash-account-name">{name}</strong>
      <Amount value={balance} hide={hide} className="cash-account-balance" />
      <small>Готівка · UAH</small>
    </div>
    <img className="cash-wallet-image" src={WALLET_IMAGE} alt="Об’ємний графітовий гаманець" width="144" height="144" draggable={false} />
  </div>;
}
