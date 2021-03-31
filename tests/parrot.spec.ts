import {
  BN,
  Provider,
  setProvider,
  web3,
  workspace,
  Program,
} from "@project-serum/anchor";
import { NodeWallet } from "@project-serum/anchor/dist/provider";
import {
  createMint,
  createTokenAccount,
  getMintInfo,
  getTokenAccount,
} from "@project-serum/common";
import { TokenInstructions } from "@project-serum/serum";
import { mintTo } from "@project-serum/serum/lib/token-instructions";
import assert from "assert";

export interface ProgramState {  
  debtType: web3.PublicKey;
  debtToken: web3.PublicKey;
  debtMinter: web3.PublicKey;

  vaultType: web3.PublicKey;

  collateralToken: web3.PublicKey;
  collateralTokenHolder: web3.PublicKey;
}

export interface UserState {
  // User collateral token address
  collateralTokenAccount: web3.PublicKey;
  // User dept token address
  debtTokenAccount: web3.PublicKey;
  vault: web3.PublicKey;
}

const programState: ProgramState = {
  debtType: null,
  debtToken: null,
  debtMinter: null,
  vaultType: null,
  collateralToken: null,
  collateralTokenHolder: null,
} as any;

const userState: UserState = {
  collateralTokenAccount: null,
  debtTokenAccount: null,
  vault: null,
} as any;

describe("Parrot Lending", async () => {
  // Configure the client to use the local cluster.
  setProvider(Provider.env());

  const program: Program = workspace.Parrot;
  const provider: Provider = program.provider;
  const wallet: NodeWallet = provider.wallet as any;

  it("Init new Dept Type (pUSD)", async () => {
    const debtType = new web3.Account();

    const [debtMinter, nonce] = await web3.PublicKey.findProgramAddress(
      [debtType.publicKey.toBuffer()],
      program.programId
    );

    const debtToken = await createMint(provider, debtMinter, 9);

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
    programState.debtMinter = debtMinter;

    const debtTypeAccount = await program.account.debtType(debtType.publicKey);

    assert.ok(debtTypeAccount.nonce === nonce);
  });

  it("Init new Vault Type (BTC)", async () => {
    const vaultType = new web3.Account();

    const collateralToken = await createMint(provider, wallet.publicKey, 9);

    const [vaultTypeAuth, nonce] = await web3.PublicKey.findProgramAddress(
      [vaultType.publicKey.toBuffer()],
      program.programId
    );

    const collateralTokenHolder = await createTokenAccount(
      provider,
      collateralToken,
      vaultTypeAuth
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

    const vaultTypeAccount = await program.account.vaultType(
      vaultType.publicKey
    );

    assert.ok(vaultTypeAccount.nonce === nonce);
  });

  it("Create user collateral token account and airdrop 1000 BTC for testing", async () => {
    const collateralTokenAccount = await createTokenAccount(
      provider,
      programState.collateralToken,
      wallet.publicKey
    );
    userState.collateralTokenAccount = collateralTokenAccount;

    // airdrop 1000 token to the user
    const airdropAmount = new BN(1000);
    const minter = await getMintInfo(provider, programState.collateralToken);
    const tx = new web3.Transaction();
    tx.add(
      mintTo({
        mint: programState.collateralToken,
        mintAuthority: minter.mintAuthority,
        destination: collateralTokenAccount,
        amount: airdropAmount,
      })
    );
    await provider.send(tx, [wallet.payer]);
    const checkBalance = await getTokenAccount(
      provider,
      collateralTokenAccount
    );

    assert.ok(checkBalance.amount.eq(airdropAmount));
  });

  it("Create user debt token account for testing", async () => {
    const debtTokenAccount = await createTokenAccount(
      provider,
      programState.debtToken,
      wallet.publicKey
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
        owner: wallet.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [vault],
      instructions: [await program.account.vault.createInstruction(vault)],
    });

    const vaultAccount = await program.account.vault(vault.publicKey);

    assert.ok(vaultAccount.debtAmount.eq(debtAmount));
    assert.ok(vaultAccount.collateralAmount.eq(collateralAmount));
  });

  it("User Stake (Deposit) 100 BTC", async () => {
    // amount to stake
    const amount = new BN(100);

    await program.rpc.stake(amount, {
      accounts: {
        vaultType: programState.vaultType,
        vault: userState.vault,
        collateralFrom: userState.collateralTokenAccount,
        collateralFromAuthority: wallet.publicKey,
        collateralTo: programState.collateralTokenHolder,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
      },
    });

    const vaultAccount = await program.account.vault(userState.vault);
    const vaultCollateralBalance = await getTokenAccount(
      provider,
      programState.collateralTokenHolder
    );
    assert.ok(vaultAccount.collateralAmount.eq(amount));
    assert.ok(vaultCollateralBalance.amount.eq(amount));    
  });

  it("User Mint (Borrow) 10 pUSD", async () => {
    // amount to borrow
    const amount = new BN(10);

    // const debtMinter = await this.programAccount(
    //   this.deploy.debtType,
    //   "minter",
    // );

    await program.rpc.borrow(amount, {
      accounts: {
        debtType: programState.debtType,
        vaultType: programState.vaultType,
        debtToken: programState.debtToken, // can we use the one from debtType
        vault: userState.vault,
        debtMinter: programState.debtMinter,
        debtTo: userState.debtTokenAccount,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
        // priceOracle: this.deploy.priceOracle,
      },
    });

    const vaultAccount = await program.account.vault(userState.vault);
    const userDebtBalance = await getTokenAccount(
      provider,
      userState.debtTokenAccount
    );
    assert.ok(vaultAccount.debtAmount.eq(amount));
    assert.ok(userDebtBalance.amount.eq(amount));  
  });
});
