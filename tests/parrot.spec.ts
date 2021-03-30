import {
  BN,
  Provider,
  setProvider,
  web3,
  workspace
} from "@project-serum/anchor";
import { NodeWallet } from "@project-serum/anchor/dist/provider";
import { TokenInstructions, } from "@project-serum/serum";
import { Token, u64 } from "@solana/spl-token";
import assert from "assert";
import { createToken, newAccountWithLamports } from "./utils";



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
  let collateralTokenHolder:web3.PublicKey;

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
      [debtToken.publicKey.toBuffer()],
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
    const [mintAuthority, nonce] = await web3.PublicKey.findProgramAddress(
      [wallet.publicKey.toBuffer()],
      program.programId
    );
    collateralTokenAccount = await createToken(
      provider.connection,
      wallet.payer,
      mintAuthority,
    );
    collateralTokenHolder = await collateralTokenAccount.createAccount(
      vaultType.publicKey
    );

    await program.rpc.initVaultType(nonce, {
      accounts: {
        debtType: debtType.publicKey,
        vaultType: vaultType.publicKey,
        owner: wallet.publicKey,
        collateralToken: collateralToken.publicKey,
        collateralTokenHolder: collateralTokenHolder,
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
    const userWallet = wallet; // await newAccountWithLamports(provider.connection)
    const stakeAmount = new BN(100);

    // Create a token for the user wallet to use as collateral and Mint the amount we want to stake
    const userCollateralFrom = await collateralTokenAccount.createAccount(
      userWallet.publicKey
    );
    // await collateralTokenAccount.mintTo(
    //   userCollateralFrom,
    //   collateralToken.publicKey,
    //   [],
    //   new u64(stakeAmount.toString())
    // );
    // const userCollateralFromInfo = await collateralTokenAccount.getAccountInfo(
    //   userCollateralFrom
    // );
    // assert.ok(userCollateralFromInfo.amount.eq(stakeAmount));

    console.log('initStake');
    
    // Create a signer to transfer the user token to collateralTokenHolder address
    const [_, nonce] = await web3.PublicKey.findProgramAddress(
      [vaultType.publicKey.toBuffer()],
      program.programId
    )

    await program.rpc.stake(stakeAmount, nonce, {
      accounts: {
        vaultType: vaultType.publicKey,
        vault: vault.publicKey,
        collateralFrom: userCollateralFrom,
        collateralFromAuthority: userWallet.publicKey,
        collateralTo: collateralTokenHolder,
        tokenProgram: TokenInstructions.TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [],
    });


    console.log("TODO: check the vault");

  });

  // it('Mint (Borrow)', async () => {
  //   //
  // });
});
