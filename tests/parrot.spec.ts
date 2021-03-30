import {
  BN,
  Provider,
  setProvider,
  web3,
  workspace
} from "@project-serum/anchor";
import { NodeWallet } from "@project-serum/anchor/dist/provider";
import { TokenInstructions } from "@project-serum/serum";
import { Token, u64 } from "@solana/spl-token";
import assert from "assert";

async function createToken(
  connection: web3.Connection,
  payer: web3.Account,
  mintAuthority: web3.PublicKey,
  decimals = 8
) {
  const token = await Token.createMint(
    connection,
    payer,
    mintAuthority,
    null,
    decimals,
    TokenInstructions.TOKEN_PROGRAM_ID
  );
  return token;
}

describe("Parrot Lending", async () => {
  // Configure the client to use the local cluster.
  setProvider(Provider.env());

  const program = workspace.Parrot;
  const provider: Provider = program.provider;
  const wallet: NodeWallet = provider.wallet as any;

  const debtType = new web3.Account();
  const debtToken = new web3.Account();

  const vaultType = new web3.Account();
  const collateralToken = new web3.Account();

  const vault = new web3.Account();
  const collateralTokenHolder = new web3.Account();

  /**
   * pUSD
   */
  let deptTokenAccount: Token;
  /**
   * BTC
   */
  let collateralTokenAccount: Token;

  it("Init new Dept Type (pUSD)", async () => {
    const [mintAuthority, nonce] = await web3.PublicKey.findProgramAddress(
      [wallet.publicKey.toBuffer()],
      program.programId
    );
    deptTokenAccount = await createToken(
      provider.connection,
      wallet.payer,
      mintAuthority
    );

    await program.rpc.initDebtType(nonce, {
      accounts: {
        debtType: debtType.publicKey,
        debtToken: debtToken.publicKey,
        owner: wallet.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [debtType],
      instructions: [
        await program.account.debtType.createInstruction(debtType),
      ],
    });

    const debtTypeAccount = await program.account.debtType(debtType.publicKey);

    assert.ok(debtTypeAccount.nonce === nonce);
  });

  it("Init new Vault Type (BTC)", async () => {
    // const [mintAuthority, nonce] = await web3.PublicKey.findProgramAddress(
    //   [wallet.publicKey.toBuffer()],
    //   program.programId
    // );
    // TODO: VaultType should be the minter? how to mint coin to user wallet collateralFrom then?
    const nonce = 0;
    collateralTokenAccount = await createToken(
      provider.connection,
      wallet.payer,
      wallet.publicKey
      // mintAuthority
    );

    await program.rpc.initVaultType(nonce, {
      accounts: {
        debtType: debtType.publicKey,
        vaultType: vaultType.publicKey,
        owner: wallet.publicKey,
        collateralToken: collateralToken.publicKey,
        collateralTokenHolder: collateralTokenHolder.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [vaultType],
      instructions: [
        await program.account.vaultType.createInstruction(vaultType),
      ],
    });

    const vaultTypeAccount = await program.account.vaultType(
      vaultType.publicKey
    );

    assert.ok(vaultTypeAccount.nonce === nonce);
  });

  it("Init new Vault (BTC:pUSD)", async () => {
    const debtAmount = new BN(0);
    const collateralAmount = new BN(0);

    await program.rpc.initVault(debtAmount, collateralAmount, {
      accounts: {
        debtType: debtType.publicKey,
        vaultType: vaultType.publicKey,
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

  it("Stake (Deposit)", async () => {
    const stakeAmount = new BN(100);
    const userAccount = new web3.Account();

    // Create a token for the user wallet to use as collateral and Mint the amount we want to stake
    const userCollateralFrom = await collateralTokenAccount.createAccount(
      userAccount.publicKey
    );
    await collateralTokenAccount.mintTo(
      userCollateralFrom,
      wallet.publicKey,
      [],
      new u64(stakeAmount.toString())
    );
    const userCollateralFromInfo = await collateralTokenAccount.getAccountInfo(
      userCollateralFrom
    );
    assert.ok(userCollateralFromInfo.amount.eq(stakeAmount));


    // Create a signer to transfer the user token to collateralTokenHolder address
    const [signer, nonce] = await web3.PublicKey.findProgramAddress(
      [userAccount.publicKey.toBuffer()],
      program.programId
    )

    const stake = new web3.Account();

    await program.rpc.initStake(stakeAmount, nonce, {
      accounts: {
        stake: stake.publicKey,
        vaultType: vaultType.publicKey,
        vault: vault.publicKey,
        collateralFrom: userCollateralFrom,
        collateralFromAuthority: signer,
        collateralTo: collateralTokenHolder.publicKey,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [stake],
      instructions: [await program.account.stake.createInstruction(stake)],
    });

    const stakeAccount = await program.account.stake(stake.publicKey);

    console.log("stakeAccount", stakeAccount);

  });

  // it('Mint (Borrow)', async () => {
  //   //
  // });
});
