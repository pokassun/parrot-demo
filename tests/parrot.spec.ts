import {
  BN,
  Provider,
  setProvider,
  web3,
  workspace,
  Program,
  Wallet,
} from "@project-serum/anchor";
import {
  createMint,
  createTokenAccount,
  getMintInfo,
  getTokenAccount,
} from "@project-serum/common";
import { TokenInstructions } from "@project-serum/serum";
import { mintTo } from "@project-serum/serum/lib/token-instructions";
import assert from "assert";
import { newAccountWithLamports } from "./utils";

export interface ProgramState {
  debtType: web3.PublicKey;
  debtToken: web3.PublicKey;
  debtTokenAuthority: web3.PublicKey;

  vaultType: web3.PublicKey;

  collateralToken: web3.PublicKey;
  collateralTokenHolder: web3.PublicKey;
  collateralTokenHolderAuthority: web3.PublicKey;
}

export interface UserState {
  userWallet: web3.Account;
  userProvider: Provider;
  // User collateral token address
  collateralTokenAccount: web3.PublicKey;
  // User debt token address
  debtTokenAccount: web3.PublicKey;
  vault: web3.PublicKey;
}

const programState: ProgramState = {
  debtType: null,
  debtToken: null,
  debtTokenAuthority: null,
  vaultType: null,
  collateralToken: null,
  collateralTokenHolder: null,
  collateralTokenHolderAuthority: null,
} as any;

const userState: UserState = {
  userWallet: null,
  vault: null,
  debtTokenAccount: null,
  collateralTokenAccount: null,
} as any;

describe("Parrot Lending", async () => {
  // Configure the client to use the local cluster.
  setProvider(Provider.local());

  const program: Program = workspace.Parrot;
  const provider: Provider = program.provider;
  const wallet: Wallet = provider.wallet as any;

  it("Init new Debt Type (pUSD)", async () => {
    const debtType = new web3.Account();

    const [debtTokenAuthority, nonce] = await web3.PublicKey.findProgramAddress(
      [debtType.publicKey.toBuffer()],
      program.programId
    );

    const debtToken = await createMint(provider, debtTokenAuthority, 9);

    await program.rpc.initDebtType(nonce, {
      accounts: {
        debtType: debtType.publicKey,
        debtToken: debtToken,
        owner: wallet.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [debtType],
      instructions: [
        await program.account.debtType.createInstruction(debtType),
      ],
    });

    programState.debtType = debtType.publicKey;
    programState.debtToken = debtToken;
    programState.debtTokenAuthority = debtTokenAuthority;

    const debtTypeAccount = await program.account.debtType(debtType.publicKey);

    assert.ok(debtTypeAccount.nonce === nonce);
  });

  it("Init new Vault Type (BTC)", async () => {
    const vaultType = new web3.Account();

    const collateralToken = await createMint(provider, wallet.publicKey, 9);

    const [
      collateralTokenHolderAuthority,
      nonce,
    ] = await web3.PublicKey.findProgramAddress(
      [vaultType.publicKey.toBuffer()],
      program.programId
    );

    const collateralTokenHolder = await createTokenAccount(
      provider,
      collateralToken,
      collateralTokenHolderAuthority
    );

    await program.rpc.initVaultType(nonce, {
      accounts: {
        debtType: programState.debtType,
        vaultType: vaultType.publicKey,
        owner: wallet.publicKey,
        collateralToken: collateralToken,
        collateralTokenHolder: collateralTokenHolder,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [vaultType],
      instructions: [
        await program.account.vaultType.createInstruction(vaultType),
      ],
    });

    programState.vaultType = vaultType.publicKey;
    programState.collateralToken = collateralToken;
    programState.collateralTokenHolder = collateralTokenHolder;
    programState.collateralTokenHolderAuthority = collateralTokenHolderAuthority;

    const vaultTypeAccount = await program.account.vaultType(
      vaultType.publicKey
    );

    assert.ok(vaultTypeAccount.nonce === nonce);
  });

  it("Create user collateral token account and airdrop 100 BTC for testing", async () => {
    const userWallet = await newAccountWithLamports(provider.connection);
    userState.userWallet = userWallet;
    userState.userProvider = new Provider(provider.connection, new Wallet(userWallet), {});

    const collateralTokenAccount = await createTokenAccount(
      userState.userProvider,
      programState.collateralToken,
      userState.userWallet.publicKey
    );
    userState.collateralTokenAccount = collateralTokenAccount;

    // airdrop 100 token to the user
    const airdropAmount = new BN(100);
    const minter = await getMintInfo(userState.userProvider, programState.collateralToken);
    const tx = new web3.Transaction();
    tx.add(
      mintTo({
        mint: programState.collateralToken,
        mintAuthority: minter.mintAuthority,
        destination: collateralTokenAccount,
        amount: airdropAmount,
      })
    );
    await userState.userProvider.send(tx, [wallet.payer]);
    const checkBalance = await getTokenAccount(
      userState.userProvider,
      collateralTokenAccount
    );

    assert.ok(checkBalance.amount.eq(airdropAmount));
  });

  it("Create user debt token account for testing", async () => {
    const debtTokenAccount = await createTokenAccount(
      userState.userProvider,
      programState.debtToken,
      userState.userWallet.publicKey
    );
    userState.debtTokenAccount = debtTokenAccount;
  });

  it("Init User Vault (BTC:pUSD)", async () => {
    const debtAmount = new BN(0);
    const collateralAmount = new BN(0);

    const vault = new web3.Account();

    userState.vault = vault.publicKey;

    await program.rpc.initVault(debtAmount, collateralAmount, {
      accounts: {
        debtType: programState.debtType,
        vaultType: programState.vaultType,
        vault: vault.publicKey,
        owner: userState.userWallet.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [vault],
      instructions: [await program.account.vault.createInstruction(vault)],
    });

    const vaultAccount = await program.account.vault(vault.publicKey);

    assert.ok(vaultAccount.debtAmount.eq(debtAmount));
    assert.ok(vaultAccount.collateralAmount.eq(collateralAmount));
  });

  it("User Stake (Deposit) 100 BTC as Collateral", async () => {
    // amount to stake
    const amount = new BN(100);

    await program.rpc.stake(amount, {
      accounts: {
        vaultType: programState.vaultType,
        vault: userState.vault,
        collateralFrom: userState.collateralTokenAccount,
        collateralFromAuthority: userState.userWallet.publicKey,
        collateralTo: programState.collateralTokenHolder,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
      signers:[userState.userWallet]
    });

    const vaultAccount = await program.account.vault(userState.vault);
    const vaultCollateralBalance = await getTokenAccount(
      userState.userProvider,
      programState.collateralTokenHolder
    );
    assert.ok(vaultAccount.collateralAmount.eq(amount));
    assert.ok(vaultCollateralBalance.amount.eq(amount));
  });

  it("User Mint (Borrow) 10 pUSD as Debt", async () => {
    // amount to borrow
    const amount = new BN(10);

    await program.rpc.borrow(amount, {
      accounts: {
        debtType: programState.debtType,
        vaultType: programState.vaultType,
        vault: userState.vault,
        vaultOwner: userState.userWallet.publicKey, // Make sure is my vault
        receiver: userState.debtTokenAccount,
        debtToken: programState.debtToken,
        debtTokenAuthority: programState.debtTokenAuthority,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    });

    // check if I received my pUSD tokens
    const vaultAccount = await program.account.vault(userState.vault);
    const userDebtBalance = await getTokenAccount(
      userState.userProvider,
      userState.debtTokenAccount
    );
    assert.ok(vaultAccount.debtAmount.eq(amount));
    assert.ok(userDebtBalance.amount.eq(amount));
  });

  it("User RePay the 10 pUSD Debt", async () => {
    // amount to repay (previously borrowed)
    const amount = new BN(10);

    await program.rpc.repay(amount, {
      accounts: {
        debtType: programState.debtType,
        vaultType: programState.vaultType,
        vault: userState.vault,
        vaultOwner: userState.userWallet.publicKey, // Make sure is my vault
        debtToken: programState.debtToken,
        debtFrom: userState.debtTokenAccount,
        debtFromAuthority: userState.userWallet.publicKey, // Authority for transfer token from debtFrom to burn
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
      signers:[userState.userWallet]
    });

    // check if I sent my pUSD debt tokens
    const vaultAccount = await program.account.vault(userState.vault);
    const userDebtBalance = await getTokenAccount(
      userState.userProvider,
      userState.debtTokenAccount
    );
    assert.ok(vaultAccount.debtAmount.eq(new BN(0)));
    assert.ok(userDebtBalance.amount.eq(new BN(0)));
  });

  it("User Unstake (Withdraw) 100 BTC Collateral", async () => {
    // amount to unstake (previously staked)
    const amount = new BN(100);

    await program.rpc.unstake(amount, {
      accounts: {
        vaultType: programState.vaultType,
        vault: userState.vault,
        vaultOwner: userState.userWallet.publicKey, // Make sure is my vault
        receiver: userState.collateralTokenAccount,
        collateralToken: programState.collateralToken,
        collateralTokenHolder: programState.collateralTokenHolder,
        collateralTokenHolderAuthority:
          programState.collateralTokenHolderAuthority,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    });

    // check if I get my BTC collateral tokens back
    const vaultAccount = await program.account.vault(userState.vault);
    const userCollateralBalance = await getTokenAccount(
      userState.userProvider,
      userState.collateralTokenAccount
    );    
    assert.ok(vaultAccount.collateralAmount.eq(new BN(0)));
    assert.ok(userCollateralBalance.amount.eq(new BN(100)));
  });
});
