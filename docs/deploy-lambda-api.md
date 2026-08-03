# Deploy `apps/api` len AWS Lambda

Tai lieu nay huong dan theo muc tieu hoc Lambda nhanh, chi deploy backend, va chua noi DynamoDB local voi Lambda.

## 1. Ban can hieu truoc

- Lambda tren AWS khong goi truc tiep duoc `DynamoDB Local` dang chay trong Docker tren may ban.
- De lam quen Lambda, ban nen test bang endpoint nhe nhu `GET /health`.
- Neu goi cac route CRUD dang dung DynamoDB, Lambda se chi chay duoc khi ban cung cap `DynamoDB` tren AWS hoac sua code sang mock data.

Project da duoc cau hinh de:

- local: `npm run dev -w @supermarket/api`
- dong goi zip cho Lambda: `npm run package:lambda -w @supermarket/api`

## 2. Chuan bi tren may

Tai thu muc goc project:

```bash
npm install
npm run build -w @supermarket/api
```

Neu build ok, tao file zip deploy:

```bash
npm run package:lambda -w @supermarket/api
```

Sau lenh nay, ban se co file:

- `apps/api/dist/lambda.zip`

## 3. Tao Lambda tren AWS Console

1. Dang nhap AWS Console.
2. Tim `Lambda`.
3. Chon `Create function`.
4. Chon `Author from scratch`.
5. Dien:
   - Function name: `supermarket-api-demo`
   - Runtime: `Node.js 22.x` neu co, neu khong thi chon `Node.js 20.x`
   - Architecture: `x86_64`
6. Chon `Create function`.

## 4. Upload code zip

1. Trong function vua tao, mo tab `Code`.
2. Bam `Upload from`.
3. Chon `.zip file`.
4. Upload file `apps/api/dist/lambda.zip`.
5. Sau khi upload xong, vao `Runtime settings`.
6. Bam `Edit`.
7. Dat `Handler` thanh:

```text
src/lambda.handler
```

8. Bam `Save`.

## 5. Cau hinh memory, timeout, env

Vao `Configuration`.

### General configuration

- Memory: `128 MB` hoac `256 MB`
- Timeout: `5 sec` hoac `10 sec`

### Environment variables

Them it nhat:

```text
AWS_REGION=ap-southeast-1
DYNAMODB_TABLE_NAME=MarketplaceProducts
```

Luu y:

- Khong can them `DYNAMODB_ENDPOINT` neu deploy Lambda de hoc route `health`.
- Khong can them `AWS_ACCESS_KEY_ID` va `AWS_SECRET_ACCESS_KEY` trong Lambda neu sau nay dung DynamoDB that tren AWS.

## 6. Tao Function URL de test free va nhanh

1. Vao muc `Function URL`.
2. Bam `Create function URL`.
3. Auth type: `NONE`
4. Cau hinh CORS:
   - de hoc nhanh, co the tam thoi de mac dinh
5. Bam `Save`.

Sau do AWS se cap cho ban 1 URL dang:

```text
https://abcxyz.lambda-url.ap-southeast-1.on.aws/
```

## 7. Test

Test route health:

```text
GET https://...lambda-url.../health
```

Ket qua mong doi:

```json
{ "status": "ok" }
```

Ban cung co the test:

```text
GET https://...lambda-url.../api/learning
```

Route nay khong can DynamoDB.

## 8. Neu bi loi

### Loi 1: `Cannot find package`

Nguyen nhan:

- Ban upload sai zip
- Hoac chua chay lai `npm run package:lambda -w @supermarket/api`

Cach xu ly:

1. Xoa file zip cu.
2. Chay lai:

```bash
npm run package:lambda -w @supermarket/api
```

3. Upload lai.

### Loi 2: `Handler not found`

Kiem tra lai `Handler`:

```text
src/lambda.handler
```

### Loi 3: Route CRUD loi 500

Nguyen nhan:

- Cac route shopping dang doc/ghi DynamoDB
- Lambda cua ban khong truy cap duoc Docker local tren may ban

Cach hieu dung:

- `health` ok la ban da deploy Lambda thanh cong
- muon CRUD chay that, ban can dung DynamoDB tren AWS hoac doi qua mock data

## 9. Lenh local quan trong

Chay backend local:

```bash
npm run dev -w @supermarket/api
```

Kiem tra syntax:

```bash
npm run build -w @supermarket/api
```

Dong goi Lambda:

```bash
npm run package:lambda -w @supermarket/api
```

## 10. Buoc tiep theo neu ban muon

Sau khi test `health` thanh cong, co 2 huong:

1. Giu Lambda chi de hoc invocation, logs, env vars, Function URL.
2. Nang cap tiep de `shopping API` chay that bang cach dua DynamoDB len AWS.
