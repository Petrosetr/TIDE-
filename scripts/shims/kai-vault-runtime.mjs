import { coinWithBalance } from "@mysten/sui/transactions";

const KAI_SAV_PUBLISHED_AT = "0x909ad5f8badc34b49507dbd0cb9fb88cc816b531323659e3aefb992d4ab58474";
const SUI_CLOCK_OBJECT_ID = "0x6";

function createCoinMeta({
  typeName,
  decimals,
  symbol,
  displaySymbol,
  name,
  iconUrl = "",
}) {
  return Object.freeze({
    typeName,
    decimals,
    symbol,
    displaySymbol,
    name,
    iconUrl,
  });
}

function intoBalance(tx, typeName, coin) {
  return tx.moveCall({
    target: "0x2::coin::into_balance",
    typeArguments: [typeName],
    arguments: [coin],
  });
}

function fromBalance(tx, typeName, balance) {
  return tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [typeName],
    arguments: [balance],
  });
}

function depositToKaiVault(tx, typeArguments, { vault, balance, clock = SUI_CLOCK_OBJECT_ID }) {
  return tx.moveCall({
    target: `${KAI_SAV_PUBLISHED_AT}::vault::deposit`,
    typeArguments,
    arguments: [
      tx.object(vault),
      balance,
      tx.object(clock),
    ],
  });
}

export const kaiWBTC = createCoinMeta({
  typeName: "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC",
  decimals: 8,
  symbol: "wBTC",
  displaySymbol: "wBTC",
  name: "Wrapped Bitcoin",
  iconUrl: "https://coinmeta.polymedia.app/img/coins/0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b-btc-BTC.webp",
});

export const kaiLBTC = createCoinMeta({
  typeName: "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC",
  decimals: 8,
  symbol: "LBTC",
  displaySymbol: "LBTC",
  name: "Lombard Staked BTC",
  iconUrl: "https://www.lombard.finance/lbtc/LBTC.png",
});

export const kaiXBTC = createCoinMeta({
  typeName: "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC",
  decimals: 8,
  symbol: "xBTC",
  displaySymbol: "xBTC",
  name: "OKX Wrapped BTC",
  iconUrl: "https://static.coinall.ltd/cdn/oksupport/common/20250512-095503.72e1f41d9b9a06.png",
});

const kaiYWBTC = createCoinMeta({
  typeName: "0xe4ff5fcc935fddaf808e27017c994b9cd75eaac81cec4bd2b4b8fdeb05a71e07::ywbtc::YWBTC",
  decimals: 8,
  symbol: "yWBTC",
  displaySymbol: "yWBTC",
  name: "Kai WBTC vault yield bearing token",
});

const kaiYLBTC = createCoinMeta({
  typeName: "0x3e83d9c798902dbcde72b9ede9fa2997ea43b302f83e4894aa793e6791e95c9f::ylbtc::YLBTC",
  decimals: 8,
  symbol: "yLBTC",
  displaySymbol: "yLBTC",
  name: "Kai LBTC vault yield bearing token",
});

const kaiYXBTC = createCoinMeta({
  typeName: "0xfc39a879b5a8772f682f1202cc5a8a3d93654cbb9e716b96bda7e5832af0e0eb::yxbtc::YXBTC",
  decimals: 8,
  symbol: "yXBTC",
  displaySymbol: "yXBTC",
  name: "Kai xBTC vault yield bearing token",
});

class KaiVaultRuntime {
  constructor({ key, T, YT, id, capId }) {
    this.key = key;
    this.T = T;
    this.YT = YT;
    this.id = id;
    this.capId = capId;
  }

  deposit(tx, balance) {
    return depositToKaiVault(tx, [this.T.typeName, this.YT.typeName], {
      vault: this.id,
      balance,
    });
  }

  async depositFromWallet(tx, walletAddress, amount) {
    if (!amount || typeof amount !== "object") {
      throw new Error("invalid amount: Kai vault deposit requires an Amount-like object");
    }
    if (amount.decimals !== this.T.decimals) {
      throw new Error("invalid amount: decimals mismatch");
    }

    tx.setSenderIfNotSet(walletAddress);

    const coin = coinWithBalance({
      type: this.T.typeName,
      balance: amount.int,
    });
    const balance = intoBalance(tx, this.T.typeName, coin);
    const lpBalance = this.deposit(tx, balance);
    const lpCoin = fromBalance(tx, this.YT.typeName, lpBalance);

    tx.transferObjects([lpCoin], tx.pure.address(walletAddress));
  }
}

export const KaiVaults = Object.freeze({
  wBTC: new KaiVaultRuntime({
    key: "wBTC",
    T: kaiWBTC,
    YT: kaiYWBTC,
    id: "0x5674aae155d38e09edaf3163f2e3f85fe77790f484485f0b480ca55915d7c446",
    capId: "0x28928d9989dcf3dfb48f34d137e92b37fc495e7782fd825bc9a40474366a4653",
  }),
  LBTC: new KaiVaultRuntime({
    key: "LBTC",
    T: kaiLBTC,
    YT: kaiYLBTC,
    id: "0x362ce1fc1425ec0bdf958f2023b07cda52c924fa42e4ff88a9a48c595fd8437d",
    capId: "0xbf8745d63ea078a5559325bb7c061625d3917cb5cc361fd6155596063d8741cc",
  }),
  xBTC: new KaiVaultRuntime({
    key: "xBTC",
    T: kaiXBTC,
    YT: kaiYXBTC,
    id: "0x653beede5a005272526f0c835c272ef37491dc5bff3f8e466175e02675510137",
    capId: "0xad78fad7f003b536675e3b0668f08949035067eb793f92578e26b14eafd1b68d",
  }),
});
